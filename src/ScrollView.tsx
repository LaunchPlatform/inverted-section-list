import invariant from "invariant";
import React, { Component, PropsWithChildren, RefObject } from "react";
import {
  Animated,
  findNodeHandle,
  HostComponent,
  Insets,
  LayoutChangeEvent,
  Platform,
  ScrollResponderEvent,
  ScrollViewProps,
  StyleSheet,
  View,
  Dimensions,
  UIManager,
  Keyboard,
  KeyboardEvent,
  EventSubscription,
} from "react-native";

const {
  default: ScrollViewContext,
  HORIZONTAL,
  VERTICAL,
} = require("react-native/Libraries/Components/ScrollView/ScrollViewContext");
const ScrollViewStickyHeader = require("react-native/Libraries/Components/ScrollView/ScrollViewStickyHeader");
const {
  default: processDecelerationRate,
} = require("react-native/Libraries/Components/ScrollView/processDecelerationRate");
const setAndForwardRef = require("react-native/Libraries/Utilities/setAndForwardRef");
const {
  default: dismissKeyboard,
} = require("react-native/Libraries/Utilities/dismissKeyboard");
const {
  default: splitLayoutProps,
} = require("react-native/Libraries/StyleSheet/splitLayoutProps");
const flattenStyle = require("react-native/Libraries/StyleSheet/flattenStyle");
const resolveAssetSource = require("react-native/Libraries/Image/resolveAssetSource");
const {
  attachNativeEvent,
} = require("react-native/Libraries/Animated/AnimatedEvent");

const { default: AndroidHorizontalScrollViewNativeComponent } =
  require("react-native/Libraries/Components/ScrollView/AndroidHorizontalScrollViewNativeComponent").default;
const {
  default: AndroidHorizontalScrollContentViewNativeComponent,
} = require("react-native/Libraries/Components/ScrollView/AndroidHorizontalScrollContentViewNativeComponent");
const {
  default: ScrollViewNativeComponent,
} = require("react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent");
const {
  default: ScrollContentViewNativeComponent,
} = require("react-native/Libraries/Components/ScrollView/ScrollContentViewNativeComponent");
const {
  default: ScrollViewCommands,
} = require("react-native/Libraries/Components/ScrollView/ScrollViewCommands");
const TextInputState = require("react-native/Libraries/Components/TextInput/TextInputState");
const FrameRateLogger = require("react-native/Libraries/Interaction/FrameRateLogger");

interface PressEvent {
  readonly target: any;
  readonly nativeEvent: any;
}
interface ScrollEvent {
  readonly target: any;
  readonly nativeEvent: any;
}

let AndroidScrollView: any;
let AndroidHorizontalScrollContentView: any;
let AndroidHorizontalScrollView: any;
let RCTScrollView: any;
let RCTScrollContentView: any;

if (Platform.OS === "android") {
  AndroidScrollView = ScrollViewNativeComponent;
  AndroidHorizontalScrollView = AndroidHorizontalScrollViewNativeComponent;
  AndroidHorizontalScrollContentView =
    AndroidHorizontalScrollContentViewNativeComponent;
} else {
  RCTScrollView = ScrollViewNativeComponent;
  RCTScrollContentView = ScrollContentViewNativeComponent;
}

// Public methods for ScrollView
export interface ScrollViewImperativeMethods {
  // TODO:
}

export type ScrollResponderType = ScrollViewImperativeMethods;

export type Props = ScrollViewProps & {
  scrollViewRef?: RefObject<any>;
  innerViewRef?: RefObject<any>;
  contentOffset?: { x: number; y: number };
  contentInset?: Insets;
  scrollBarThumbImage?: string;
  StickyHeaderComponent?: Component<ScrollViewStickyHeaderProps>;
  onKeyboardWillShow: (event: KeyboardEvent) => void;
  onKeyboardWillHide: (event: KeyboardEvent) => void;
  onKeyboardDidShow: (event: KeyboardEvent) => void;
  onKeyboardDidHide: (event: KeyboardEvent) => void;
};

type State = {
  layoutHeight: number | null;
};

const IS_ANIMATING_TOUCH_START_THRESHOLD_MS = 16;

export type ScrollViewStickyHeaderProps = PropsWithChildren<{
  nextHeaderLayoutY: number;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue: Animated.Value;
  // The height of the parent ScrollView. Currently only set when inverted.
  scrollViewHeight: number;
  nativeID?: string;
  hiddenOnScroll?: boolean;
}>;

const styles = StyleSheet.create({
  baseVertical: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "column",
    overflow: "scroll",
  },
  baseHorizontal: {
    flexGrow: 1,
    flexShrink: 1,
    flexDirection: "row",
    overflow: "scroll",
  },
  contentContainerHorizontal: {
    flexDirection: "row",
  },
});

/*
 * iOS scroll event timing nuances:
 * ===============================
 *
 *
 * Scrolling without bouncing, if you touch down:
 * -------------------------------
 *
 * 1. `onMomentumScrollBegin` (when animation begins after letting up)
 *    ... physical touch starts ...
 * 2. `onTouchStartCapture`   (when you press down to stop the scroll)
 * 3. `onTouchStart`          (same, but bubble phase)
 * 4. `onResponderRelease`    (when lifting up - you could pause forever before * lifting)
 * 5. `onMomentumScrollEnd`
 *
 *
 * Scrolling with bouncing, if you touch down:
 * -------------------------------
 *
 * 1. `onMomentumScrollBegin` (when animation begins after letting up)
 *    ... bounce begins ...
 *    ... some time elapses ...
 *    ... physical touch during bounce ...
 * 2. `onMomentumScrollEnd`   (Makes no sense why this occurs first during bounce)
 * 3. `onTouchStartCapture`   (immediately after `onMomentumScrollEnd`)
 * 4. `onTouchStart`          (same, but bubble phase)
 * 5. `onTouchEnd`            (You could hold the touch start for a long time)
 * 6. `onMomentumScrollBegin` (When releasing the view starts bouncing back)
 *
 * So when we receive an `onTouchStart`, how can we tell if we are touching
 * *during* an animation (which then causes the animation to stop)? The only way
 * to tell is if the `touchStart` occurred immediately after the
 * `onMomentumScrollEnd`.
 *
 * This is abstracted out for you, so you can just call this.scrollResponderIsAnimating() if
 * necessary
 *
 * `ScrollView` also includes logic for blurring a currently focused input
 * if one is focused while scrolling. This is a natural place
 * to put this logic since it can support not dismissing the keyboard while
 * scrolling, unless a recognized "tap"-like gesture has occurred.
 *
 * The public lifecycle API includes events for keyboard interaction, responder
 * interaction, and scrolling (among others). The keyboard callbacks
 * `onKeyboardWill/Did/*` are *global* events, but are invoked on scroll
 * responder's props so that you can guarantee that the scroll responder's
 * internal state has been updated accordingly (and deterministically) by
 * the time the props callbacks are invoke. Otherwise, you would always wonder
 * if the scroll responder is currently in a state where it recognizes new
 * keyboard positions etc. If coordinating scrolling with keyboard movement,
 * *always* use these hooks instead of listening to your own global keyboard
 * events.
 *
 * Public keyboard lifecycle API: (props callbacks)
 *
 * Standard Keyboard Appearance Sequence:
 *
 *   this.props.onKeyboardWillShow
 *   this.props.onKeyboardDidShow
 *
 * `onScrollResponderKeyboardDismissed` will be invoked if an appropriate
 * tap inside the scroll responder's scrollable region was responsible
 * for the dismissal of the keyboard. There are other reasons why the
 * keyboard could be dismissed.
 *
 *   this.props.onScrollResponderKeyboardDismissed
 *
 * Standard Keyboard Hide Sequence:
 *
 *   this.props.onKeyboardWillHide
 *   this.props.onKeyboardDidHide
 */

// Mostly copied from
// https://github.com/facebook/react-native/blob/757bb75fbf837714725d7b2af62149e8e2a7ee51/Libraries/Components/ScrollView/ScrollView.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
class ScrollView extends Component<Props, State> {
  static Context: typeof ScrollViewContext = ScrollViewContext;

  constructor(props: Props) {
    super(props);
  }

  private _scrollAnimatedValue: Animated.Value = new Animated.Value(0);
  private _scrollAnimatedValueAttachment: { detach: () => void } | null = null;
  private _stickyHeaderRefs: Map<string, React.ElementRef<any>> = new Map();
  private _headerLayoutYs: Map<string, number> = new Map();
  private _headerLayoutHeights: Map<string, number> = new Map();

  private _keyboardWillOpenTo: KeyboardEvent | null = null;
  private _additionalScrollOffset: number = 0;
  private _isTouching: boolean = false;
  private _lastMomentumScrollBeginTime: number = 0;
  private _lastMomentumScrollEndTime: number = 0;

  // Reset to false every time becomes responder. This is used to:
  // - Determine if the scroll view has been scrolled and therefore should
  // refuse to give up its responder lock.
  // - Determine if releasing should dismiss the keyboard when we are in
  // tap-to-dismiss mode (this.props.keyboardShouldPersistTaps !== 'always').
  private _observedScrollSinceBecomingResponder: boolean = false;
  private _becameResponderWhileAnimating: boolean = false;
  private _preventNegativeScrollOffset: boolean | null = null;

  private _animated: boolean | null = null;

  private _subscriptionKeyboardWillShow: EventSubscription | null = null;
  private _subscriptionKeyboardWillHide: EventSubscription | null = null;
  private _subscriptionKeyboardDidShow: EventSubscription | null = null;
  private _subscriptionKeyboardDidHide: EventSubscription | null = null;

  state: State = {
    layoutHeight: null,
  };

  UNSAFE_componentWillMount() {
    if (typeof this.props.keyboardShouldPersistTaps === "boolean") {
      console.warn(
        `'keyboardShouldPersistTaps={${
          this.props.keyboardShouldPersistTaps === true ? "true" : "false"
        }}' is deprecated. ` +
          `Use 'keyboardShouldPersistTaps="${
            this.props.keyboardShouldPersistTaps ? "always" : "never"
          }"' instead`
      );
    }

    this._keyboardWillOpenTo = null;
    this._additionalScrollOffset = 0;

    this._subscriptionKeyboardWillShow = Keyboard.addListener(
      "keyboardWillShow",
      this.scrollResponderKeyboardWillShow
    );
    this._subscriptionKeyboardWillHide = Keyboard.addListener(
      "keyboardWillHide",
      this.scrollResponderKeyboardWillHide
    );
    this._subscriptionKeyboardDidShow = Keyboard.addListener(
      "keyboardDidShow",
      this.scrollResponderKeyboardDidShow
    );
    this._subscriptionKeyboardDidHide = Keyboard.addListener(
      "keyboardDidHide",
      this.scrollResponderKeyboardDidHide
    );

    this._scrollAnimatedValue = new Animated.Value(
      this.props.contentOffset?.y ?? 0
    );
    this._scrollAnimatedValue.setOffset(this.props.contentInset?.top ?? 0);
    this._stickyHeaderRefs = new Map();
    this._headerLayoutYs = new Map();
    this._headerLayoutHeights = new Map();
  }

  UNSAFE_componentWillReceiveProps(nextProps: Props) {
    const currentContentInsetTop = this.props.contentInset
      ? this.props.contentInset.top
      : 0;
    const nextContentInsetTop = nextProps.contentInset
      ? nextProps.contentInset.top
      : 0;
    if (currentContentInsetTop !== nextContentInsetTop) {
      this._scrollAnimatedValue.setOffset(nextContentInsetTop || 0);
    }
  }

  componentDidMount() {
    this._updateAnimatedNodeAttachment();
  }

  componentDidUpdate() {
    this._updateAnimatedNodeAttachment();
  }

  componentWillUnmount() {
    if (this._subscriptionKeyboardWillShow != null) {
      this._subscriptionKeyboardWillShow.remove();
    }
    if (this._subscriptionKeyboardWillHide != null) {
      this._subscriptionKeyboardWillHide.remove();
    }
    if (this._subscriptionKeyboardDidShow != null) {
      this._subscriptionKeyboardDidShow.remove();
    }
    if (this._subscriptionKeyboardDidHide != null) {
      this._subscriptionKeyboardDidHide.remove();
    }

    if (this._scrollAnimatedValueAttachment) {
      this._scrollAnimatedValueAttachment.detach();
    }
  }

  _setNativeRef = setAndForwardRef({
    getForwardedRef: () => this.props.scrollViewRef,
    setLocalRef: (ref: any) => {
      this._scrollViewRef = ref;

      /*
        This is a hack. Ideally we would forwardRef to the underlying
        host component. However, since ScrollView has it's own methods that can be
        called as well, if we used the standard forwardRef then these
        methods wouldn't be accessible and thus be a breaking change.
        Therefore we edit ref to include ScrollView's public methods so that
        they are callable from the ref.
      */
      if (ref) {
        ref.getScrollResponder = this.getScrollResponder;
        ref.getScrollableNode = this.getScrollableNode;
        ref.getInnerViewNode = this.getInnerViewNode;
        ref.getInnerViewRef = this.getInnerViewRef;
        ref.getNativeScrollRef = this.getNativeScrollRef;
        ref.scrollTo = this.scrollTo;
        ref.scrollToEnd = this.scrollToEnd;
        ref.flashScrollIndicators = this.flashScrollIndicators;

        ref.scrollResponderZoomTo = (this as any).scrollResponderZoomTo;
        ref.scrollResponderScrollNativeHandleToKeyboard = (
          this as any
        ).scrollResponderScrollNativeHandleToKeyboard;
      }
    },
  });

  /**
   * Returns a reference to the underlying scroll responder, which supports
   * operations like `scrollTo`. All ScrollView-like components should
   * implement this method so that they can be composed while providing access
   * to the underlying scroll responder's methods.
   */
  getScrollResponder: () => ScrollResponderType = () => {
    // $FlowFixMe[unclear-type]
    return this as any as ScrollResponderType;
  };

  getScrollableNode: () => number | null = () => {
    return findNodeHandle(this._scrollViewRef);
  };

  getInnerViewNode: () => number | null = () => {
    return findNodeHandle(this._innerViewRef);
  };

  getInnerViewRef: () => React.ElementRef<typeof View> | null = () => {
    return this._innerViewRef;
  };

  getNativeScrollRef: () => React.ElementRef<HostComponent<any>> | null =
    () => {
      return this._scrollViewRef;
    };

  /**
   * Scrolls to a given x, y offset, either immediately or with a smooth animation.
   *
   * Example:
   *
   * `scrollTo({x: 0, y: 0, animated: true})`
   *
   * Note: The weird function signature is due to the fact that, for historical reasons,
   * the function also accepts separate arguments as an alternative to the options object.
   * This is deprecated due to ambiguity (y before x), and SHOULD NOT BE USED.
   */
  scrollTo: (
    options?:
      | {
          x?: number;
          y?: number;
          animated?: boolean;
        }
      | number,
    deprecatedX?: number,
    deprecatedAnimated?: boolean
  ) => void = (
    options?:
      | {
          x?: number;
          y?: number;
          animated?: boolean;
        }
      | number,
    deprecatedX?: number,
    deprecatedAnimated?: boolean
  ) => {
    let x, y, animated;
    if (typeof options === "number") {
      console.warn(
        "`scrollTo(y, x, animated)` is deprecated. Use `scrollTo({x: 5, y: 5, " +
          "animated: true})` instead."
      );
      y = options;
      x = deprecatedX;
      animated = deprecatedAnimated;
    } else if (options) {
      y = options.y;
      x = options.x;
      animated = options.animated;
    }
    if (this._scrollViewRef == null) {
      return;
    }
    ScrollViewCommands.scrollTo(
      this._scrollViewRef,
      x || 0,
      y || 0,
      animated !== false
    );
  };

  /**
   * If this is a vertical ScrollView scrolls to the bottom.
   * If this is a horizontal ScrollView scrolls to the right.
   *
   * Use `scrollToEnd({animated: true})` for smooth animated scrolling,
   * `scrollToEnd({animated: false})` for immediate scrolling.
   * If no options are passed, `animated` defaults to true.
   */
  scrollToEnd: (options?: { animated?: boolean } | null) => void = (
    options?: { animated?: boolean } | null
  ) => {
    // Default to true
    const animated = (options && options.animated) !== false;
    if (this._scrollViewRef == null) {
      return;
    }
    ScrollViewCommands.scrollToEnd(this._scrollViewRef, animated);
  };

  /**
   * Displays the scroll indicators momentarily.
   *
   * @platform ios
   */
  flashScrollIndicators: () => void = () => {
    if (this._scrollViewRef == null) {
      return;
    }
    ScrollViewCommands.flashScrollIndicators(this._scrollViewRef);
  };

  /**
   * This method should be used as the callback to onFocus in a TextInputs'
   * parent view. Note that any module using this mixin needs to return
   * the parent view's ref in getScrollViewRef() in order to use this method.
   * @param {number} nodeHandle The TextInput node handle
   * @param {number} additionalOffset The scroll view's bottom "contentInset".
   *        Default is 0.
   * @param {bool} preventNegativeScrolling Whether to allow pulling the content
   *        down to make it meet the keyboard's top. Default is false.
   */
  scrollResponderScrollNativeHandleToKeyboard: (
    nodeHandle: number | React.ElementRef<HostComponent<any>>,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean
  ) => void = (
    nodeHandle: number | React.ElementRef<HostComponent<any>>,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean
  ) => {
    this._additionalScrollOffset = additionalOffset || 0;
    this._preventNegativeScrollOffset = !!preventNegativeScrollOffset;

    if (this._innerViewRef == null) {
      return;
    }

    if (typeof nodeHandle === "number") {
      UIManager.measureLayout(
        nodeHandle,
        findNodeHandle(this) as any,
        this._textInputFocusError,
        this._inputMeasureAndScrollToKeyboard
      );
    } else {
      nodeHandle.measureLayout(
        this._innerViewRef as any,
        this._inputMeasureAndScrollToKeyboard,
        this._textInputFocusError
      );
    }
  };

  /**
   * A helper function to zoom to a specific rect in the scrollview. The argument has the shape
   * {x: number; y: number; width: number; height: number; animated: boolean = true}
   *
   * @platform ios
   */
  scrollResponderZoomTo: (
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      animated?: boolean;
    },
    animated?: boolean // deprecated, put this inside the rect argument instead
  ) => void = (
    rect: {
      x: number;
      y: number;
      width: number;
      height: number;
      animated?: boolean;
    },
    animated?: boolean // deprecated, put this inside the rect argument instead
  ) => {
    invariant(Platform.OS === "ios", "zoomToRect is not implemented");
    if ("animated" in rect) {
      this._animated = rect.animated!;
      delete rect.animated;
    } else if (typeof animated !== "undefined") {
      console.warn(
        "`scrollResponderZoomTo` `animated` argument is deprecated. Use `options.animated` instead"
      );
    }

    if (this._scrollViewRef == null) {
      return;
    }
    ScrollViewCommands.zoomToRect(
      this._scrollViewRef,
      rect,
      animated !== false
    );
  };

  private _textInputFocusError() {
    console.warn("Error measuring text field.");
  }

  /**
   * The calculations performed here assume the scroll view takes up the entire
   * screen - even if has some content inset. We then measure the offsets of the
   * keyboard, and compensate both for the scroll view's "contentInset".
   *
   * @param {number} left Position of input w.r.t. table view.
   * @param {number} top Position of input w.r.t. table view.
   * @param {number} width Width of the text input.
   * @param {number} height Height of the text input.
   */
  _inputMeasureAndScrollToKeyboard: (
    left: number,
    top: number,
    width: number,
    height: number
  ) => void = (left: number, top: number, width: number, height: number) => {
    let keyboardScreenY = Dimensions.get("window").height;
    if (this._keyboardWillOpenTo != null) {
      keyboardScreenY = this._keyboardWillOpenTo.endCoordinates.screenY;
    }
    let scrollOffsetY =
      top - keyboardScreenY + height + this._additionalScrollOffset;

    // By default, this can scroll with negative offset, pulling the content
    // down so that the target component's bottom meets the keyboard's top.
    // If requested otherwise, cap the offset at 0 minimum to avoid content
    // shifting down.
    if (this._preventNegativeScrollOffset === true) {
      scrollOffsetY = Math.max(0, scrollOffsetY);
    }
    this.scrollTo({ x: 0, y: scrollOffsetY, animated: true });

    this._additionalScrollOffset = 0;
    this._preventNegativeScrollOffset = false;
  };

  private _getKeyForIndex(index: number, childArray: Array<any>) {
    const child = childArray[index];
    return child && child.key;
  }

  private _updateAnimatedNodeAttachment() {
    if (this._scrollAnimatedValueAttachment) {
      this._scrollAnimatedValueAttachment.detach();
    }
    if (
      this.props.stickyHeaderIndices &&
      this.props.stickyHeaderIndices.length > 0
    ) {
      this._scrollAnimatedValueAttachment = attachNativeEvent(
        this._scrollViewRef,
        "onScroll",
        [{ nativeEvent: { contentOffset: { y: this._scrollAnimatedValue } } }]
      );
    }
  }

  private _setStickyHeaderRef(key: string, ref: React.ElementRef<any> | null) {
    if (ref) {
      this._stickyHeaderRefs.set(key, ref);
    } else {
      this._stickyHeaderRefs.delete(key);
    }
  }

  private _onStickyHeaderLayout(
    index: number,
    event: LayoutChangeEvent,
    key: string
  ) {
    const { stickyHeaderIndices } = this.props;
    if (!stickyHeaderIndices) {
      return;
    }
    const childArray = React.Children.toArray(this.props.children);
    if (key !== this._getKeyForIndex(index, childArray)) {
      // ignore stale layout update
      return;
    }

    const layoutY = event.nativeEvent.layout.y;
    const height = event.nativeEvent.layout.height;
    this._headerLayoutYs.set(key, layoutY);
    this._headerLayoutHeights.set(key, height);

    const indexOfIndex = stickyHeaderIndices.indexOf(index);
    const previousHeaderIndex = stickyHeaderIndices[indexOfIndex - 1];
    if (previousHeaderIndex != null) {
      const previousHeader = this._stickyHeaderRefs.get(
        this._getKeyForIndex(previousHeaderIndex, childArray)
      );
      previousHeader &&
        (previousHeader as any).setNextHeaderY &&
        (previousHeader as any).setNextHeaderY(layoutY);
    }

    const nextHeaderIndex = stickyHeaderIndices[indexOfIndex + 1];
    if (nextHeaderIndex != null) {
      const nextHeader = this._stickyHeaderRefs.get(
        this._getKeyForIndex(nextHeaderIndex, childArray)
      );
      nextHeader &&
        (nextHeader as any).setPrevHeaderY &&
        (nextHeader as any).setPrevHeaderY(layoutY + height);
    }
  }

  private _handleScroll = (e: ScrollResponderEvent) => {
    if (__DEV__) {
      if (
        this.props.onScroll &&
        this.props.scrollEventThrottle == null &&
        Platform.OS === "ios"
      ) {
        console.log(
          "You specified `onScroll` on a <ScrollView> but not " +
            "`scrollEventThrottle`. You will only receive one event. " +
            "Using `16` you get all the events but be aware that it may " +
            "cause frame drops, use a bigger number if you don't need as " +
            "much precision."
        );
      }
    }
    if (Platform.OS === "android") {
      if (this.props.keyboardDismissMode === "on-drag" && this._isTouching) {
        dismissKeyboard();
      }
    }
    this._observedScrollSinceBecomingResponder = true;
    this.props.onScroll && this.props.onScroll(e as any);
  };

  /**
   * Warning, this may be called several times for a single keyboard opening.
   * It's best to store the information in this method and then take any action
   * at a later point (either in `keyboardDidShow` or other).
   *
   * Here's the order that events occur in:
   * - focus
   * - willShow {startCoordinates, endCoordinates} several times
   * - didShow several times
   * - blur
   * - willHide {startCoordinates, endCoordinates} several times
   * - didHide several times
   *
   * The `ScrollResponder` module callbacks for each of these events.
   * Even though any user could have easily listened to keyboard events
   * themselves, using these `props` callbacks ensures that ordering of events
   * is consistent - and not dependent on the order that the keyboard events are
   * subscribed to. This matters when telling the scroll view to scroll to where
   * the keyboard is headed - the scroll responder better have been notified of
   * the keyboard destination before being instructed to scroll to where the
   * keyboard will be. Stick to the `ScrollResponder` callbacks, and everything
   * will work.
   *
   * WARNING: These callbacks will fire even if a keyboard is displayed in a
   * different navigation pane. Filter out the events to determine if they are
   * relevant to you. (For example, only if you receive these callbacks after
   * you had explicitly focused a node etc).
   */

  scrollResponderKeyboardWillShow: (e: KeyboardEvent) => void = (
    e: KeyboardEvent
  ) => {
    this._keyboardWillOpenTo = e;
    this.props.onKeyboardWillShow && this.props.onKeyboardWillShow(e);
  };

  scrollResponderKeyboardWillHide: (e: KeyboardEvent) => void = (
    e: KeyboardEvent
  ) => {
    this._keyboardWillOpenTo = null;
    this.props.onKeyboardWillHide && this.props.onKeyboardWillHide(e);
  };

  scrollResponderKeyboardDidShow: (e: KeyboardEvent) => void = (
    e: KeyboardEvent
  ) => {
    // TODO(7693961): The event for DidShow is not available on iOS yet.
    // Use the one from WillShow and do not assign.
    if (e) {
      this._keyboardWillOpenTo = e;
    }
    this.props.onKeyboardDidShow && this.props.onKeyboardDidShow(e);
  };

  scrollResponderKeyboardDidHide: (e: KeyboardEvent) => void = (
    e: KeyboardEvent
  ) => {
    this._keyboardWillOpenTo = null;
    this.props.onKeyboardDidHide && this.props.onKeyboardDidHide(e);
  };

  /**
   * Invoke this from an `onMomentumScrollBegin` event.
   */
  _handleMomentumScrollBegin: (e: ScrollEvent) => void = (e: ScrollEvent) => {
    this._lastMomentumScrollBeginTime = global.performance.now();
    this.props.onMomentumScrollBegin &&
      this.props.onMomentumScrollBegin(e as any);
  };

  /**
   * Invoke this from an `onMomentumScrollEnd` event.
   */
  _handleMomentumScrollEnd: (e: ScrollEvent) => void = (e: ScrollEvent) => {
    FrameRateLogger.endScroll();
    this._lastMomentumScrollEndTime = global.performance.now();
    this.props.onMomentumScrollEnd && this.props.onMomentumScrollEnd(e as any);
  };

  /**
   * Unfortunately, `onScrollBeginDrag` also fires when *stopping* the scroll
   * animation, and there's not an easy way to distinguish a drag vs. stopping
   * momentum.
   *
   * Invoke this from an `onScrollBeginDrag` event.
   */
  _handleScrollBeginDrag: (e: ScrollEvent) => void = (e: ScrollEvent) => {
    FrameRateLogger.beginScroll(); // TODO: track all scrolls after implementing onScrollEndAnimation
    this.props.onScrollBeginDrag && this.props.onScrollBeginDrag(e as any);
  };

  /**
   * Invoke this from an `onScrollEndDrag` event.
   */
  _handleScrollEndDrag: (e: ScrollEvent) => void = (e: ScrollEvent) => {
    const { velocity } = e.nativeEvent;
    // - If we are animating, then this is a "drag" that is stopping the scrollview and momentum end
    //   will fire.
    // - If velocity is non-zero, then the interaction will stop when momentum scroll ends or
    //   another drag starts and ends.
    // - If we don't get velocity, better to stop the interaction twice than not stop it.
    if (
      !this._isAnimating() &&
      (!velocity || (velocity.x === 0 && velocity.y === 0))
    ) {
      FrameRateLogger.endScroll();
    }
    this.props.onScrollEndDrag && this.props.onScrollEndDrag(e as any);
  };

  /**
   * A helper function for this class that lets us quickly determine if the
   * view is currently animating. This is particularly useful to know when
   * a touch has just started or ended.
   */
  _isAnimating: () => boolean = () => {
    const now = global.performance.now();
    const timeSinceLastMomentumScrollEnd =
      now - this._lastMomentumScrollEndTime;
    const isAnimating =
      timeSinceLastMomentumScrollEnd < IS_ANIMATING_TOUCH_START_THRESHOLD_MS ||
      this._lastMomentumScrollEndTime < this._lastMomentumScrollBeginTime;
    return isAnimating;
  };

  /**
   * Invoke this from an `onResponderGrant` event.
   */
  _handleResponderGrant: (e: PressEvent) => void = (e: PressEvent) => {
    this._observedScrollSinceBecomingResponder = false;
    this.props.onResponderGrant && this.props.onResponderGrant(e as any);
    this._becameResponderWhileAnimating = this._isAnimating();
  };

  /**
   * Invoke this from an `onResponderReject` event.
   *
   * Some other element is not yielding its role as responder. Normally, we'd
   * just disable the `UIScrollView`, but a touch has already began on it, the
   * `UIScrollView` will not accept being disabled after that. The easiest
   * solution for now is to accept the limitation of disallowing this
   * altogether. To improve this, find a way to disable the `UIScrollView` after
   * a touch has already started.
   */
  _handleResponderReject: () => void = () => {};

  /**
   * Invoke this from an `onResponderRelease` event.
   */
  _handleResponderRelease: (e: PressEvent) => void = (e: PressEvent) => {
    this._isTouching = e.nativeEvent.touches.length !== 0;
    this.props.onResponderRelease && this.props.onResponderRelease(e as any);

    if (typeof e.target === "number") {
      if (__DEV__) {
        console.error(
          "Did not expect event target to be a number. Should have been a native component"
        );
      }

      return;
    }

    // By default scroll views will unfocus a textField
    // if another touch occurs outside of it
    const currentlyFocusedTextInput = TextInputState.currentlyFocusedInput();
    if (
      this.props.keyboardShouldPersistTaps !== true &&
      this.props.keyboardShouldPersistTaps !== "always" &&
      this._keyboardIsDismissible() &&
      e.target !== currentlyFocusedTextInput &&
      !this._observedScrollSinceBecomingResponder &&
      !this._becameResponderWhileAnimating
    ) {
      TextInputState.blurTextInput(currentlyFocusedTextInput);
    }
  };

  /**
   * We will allow the scroll view to give up its lock iff it acquired the lock
   * during an animation. This is a very useful default that happens to satisfy
   * many common user experiences.
   *
   * - Stop a scroll on the left edge, then turn that into an outer view's
   *   backswipe.
   * - Stop a scroll mid-bounce at the top, continue pulling to have the outer
   *   view dismiss.
   * - However, without catching the scroll view mid-bounce (while it is
   *   motionless), if you drag far enough for the scroll view to become
   *   responder (and therefore drag the scroll view a bit), any backswipe
   *   navigation of a swipe gesture higher in the view hierarchy, should be
   *   rejected.
   */
  _handleResponderTerminationRequest: () => boolean = () => {
    return !this._observedScrollSinceBecomingResponder;
  };

  /**
   * Invoke this from an `onScroll` event.
   */
  _handleScrollShouldSetResponder: () => boolean = () => {
    // Allow any event touch pass through if the default pan responder is disabled
    if (this.props.disableScrollViewPanResponder === true) {
      return false;
    }
    return this._isTouching;
  };

  /**
   * Merely touch starting is not sufficient for a scroll view to become the
   * responder. Being the "responder" means that the very next touch move/end
   * event will result in an action/movement.
   *
   * Invoke this from an `onStartShouldSetResponder` event.
   *
   * `onStartShouldSetResponder` is used when the next move/end will trigger
   * some UI movement/action, but when you want to yield priority to views
   * nested inside of the view.
   *
   * There may be some cases where scroll views actually should return `true`
   * from `onStartShouldSetResponder`: Any time we are detecting a standard tap
   * that gives priority to nested views.
   *
   * - If a single tap on the scroll view triggers an action such as
   *   recentering a map style view yet wants to give priority to interaction
   *   views inside (such as dropped pins or labels), then we would return true
   *   from this method when there is a single touch.
   *
   * - Similar to the previous case, if a two finger "tap" should trigger a
   *   zoom, we would check the `touches` count, and if `>= 2`, we would return
   *   true.
   *
   */
  _handleStartShouldSetResponder: (e: PressEvent) => boolean = (
    e: PressEvent
  ) => {
    // Allow any event touch pass through if the default pan responder is disabled
    if (this.props.disableScrollViewPanResponder === true) {
      return false;
    }

    const currentlyFocusedInput = TextInputState.currentlyFocusedInput();

    if (
      this.props.keyboardShouldPersistTaps === "handled" &&
      this._keyboardIsDismissible() &&
      e.target !== currentlyFocusedInput
    ) {
      return true;
    }
    return false;
  };

  /**
   * There are times when the scroll view wants to become the responder
   * (meaning respond to the next immediate `touchStart/touchEnd`), in a way
   * that *doesn't* give priority to nested views (hence the capture phase):
   *
   * - Currently animating.
   * - Tapping anywhere that is not a text input, while the keyboard is
   *   up (which should dismiss the keyboard).
   *
   * Invoke this from an `onStartShouldSetResponderCapture` event.
   */
  _handleStartShouldSetResponderCapture: (e: PressEvent) => boolean = (
    e: PressEvent
  ) => {
    // The scroll view should receive taps instead of its descendants if:
    // * it is already animating/decelerating
    if (this._isAnimating()) {
      return true;
    }

    // Allow any event touch pass through if the default pan responder is disabled
    if (this.props.disableScrollViewPanResponder === true) {
      return false;
    }

    // * the keyboard is up, keyboardShouldPersistTaps is 'never' (the default),
    // and a new touch starts with a non-textinput target (in which case the
    // first tap should be sent to the scroll view and dismiss the keyboard,
    // then the second tap goes to the actual interior view)
    const { keyboardShouldPersistTaps } = this.props;
    const keyboardNeverPersistTaps =
      !keyboardShouldPersistTaps || keyboardShouldPersistTaps === "never";

    if (typeof e.target === "number") {
      if (__DEV__) {
        console.error(
          "Did not expect event target to be a number. Should have been a native component"
        );
      }

      return false;
    }

    if (
      keyboardNeverPersistTaps &&
      this._keyboardIsDismissible() &&
      e.target != null &&
      !TextInputState.isTextInput(e.target)
    ) {
      return true;
    }

    return false;
  };

  /**
   * Do we consider there to be a dismissible soft-keyboard open?
   */
  _keyboardIsDismissible: () => boolean = () => {
    const currentlyFocusedInput = TextInputState.currentlyFocusedInput();

    // We cannot dismiss the keyboard without an input to blur, even if a soft
    // keyboard is open (e.g. when keyboard is open due to a native component
    // not participating in TextInputState). It's also possible that the
    // currently focused input isn't a TextInput (such as by calling ref.focus
    // on a non-TextInput).
    const hasFocusedTextInput =
      currentlyFocusedInput != null &&
      TextInputState.isTextInput(currentlyFocusedInput);

    // Even if an input is focused, we may not have a keyboard to dismiss. E.g
    // when using a physical keyboard. Ensure we have an event for an opened
    // keyboard, except on Android where setting windowSoftInputMode to
    // adjustNone leads to missing keyboard events.
    const softKeyboardMayBeOpen =
      this._keyboardWillOpenTo != null || Platform.OS === "android";

    return hasFocusedTextInput && softKeyboardMayBeOpen;
  };

  /**
   * Invoke this from an `onTouchEnd` event.
   *
   * @param {PressEvent} e Event.
   */
  _handleTouchEnd: (e: PressEvent) => void = (e: PressEvent) => {
    const nativeEvent = e.nativeEvent;
    this._isTouching = nativeEvent.touches.length !== 0;
    this.props.onTouchEnd && this.props.onTouchEnd(e as any);
  };

  /**
   * Invoke this from an `onTouchCancel` event.
   *
   * @param {PressEvent} e Event.
   */
  _handleTouchCancel: (e: PressEvent) => void = (e: PressEvent) => {
    this._isTouching = false;
    this.props.onTouchCancel && this.props.onTouchCancel(e as any);
  };

  /**
   * Invoke this from an `onTouchStart` event.
   *
   * Since we know that the `SimpleEventPlugin` occurs later in the plugin
   * order, after `ResponderEventPlugin`, we can detect that we were *not*
   * permitted to be the responder (presumably because a contained view became
   * responder). The `onResponderReject` won't fire in that case - it only
   * fires when a *current* responder rejects our request.
   *
   * @param {PressEvent} e Touch Start event.
   */
  _handleTouchStart: (e: PressEvent) => void = (e: PressEvent) => {
    this._isTouching = true;
    this.props.onTouchStart && this.props.onTouchStart(e as any);
  };

  /**
   * Invoke this from an `onTouchMove` event.
   *
   * Since we know that the `SimpleEventPlugin` occurs later in the plugin
   * order, after `ResponderEventPlugin`, we can detect that we were *not*
   * permitted to be the responder (presumably because a contained view became
   * responder). The `onResponderReject` won't fire in that case - it only
   * fires when a *current* responder rejects our request.
   *
   * @param {PressEvent} e Touch Start event.
   */
  _handleTouchMove: (e: PressEvent) => void = (e: PressEvent) => {
    this.props.onTouchMove && this.props.onTouchMove(e as any);
  };

  private _handleLayout = (e: LayoutChangeEvent) => {
    if (this.props.invertStickyHeaders === true) {
      this.setState({ layoutHeight: e.nativeEvent.layout.height });
    }
    if (this.props.onLayout) {
      this.props.onLayout(e);
    }
  };

  private _handleContentOnLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    this.props.onContentSizeChange &&
      this.props.onContentSizeChange(width, height);
  };

  private _scrollViewRef: React.ElementRef<HostComponent<any>> | null = null;

  private _innerViewRef: React.ElementRef<typeof View> | null = null;
  private _setInnerViewRef = setAndForwardRef({
    getForwardedRef: () => this.props.innerViewRef,
    setLocalRef: (ref: any) => {
      this._innerViewRef = ref;
    },
  });

  render() {
    let ScrollViewClass;
    let ScrollContentContainerViewClass;
    if (Platform.OS === "android") {
      if (this.props.horizontal === true) {
        ScrollViewClass = AndroidHorizontalScrollView;
        ScrollContentContainerViewClass = AndroidHorizontalScrollContentView;
      } else {
        ScrollViewClass = AndroidScrollView;
        ScrollContentContainerViewClass = View;
      }
    } else {
      ScrollViewClass = RCTScrollView;
      ScrollContentContainerViewClass = RCTScrollContentView;
    }

    invariant(
      ScrollViewClass !== undefined,
      "ScrollViewClass must not be undefined"
    );

    invariant(
      ScrollContentContainerViewClass !== undefined,
      "ScrollContentContainerViewClass must not be undefined"
    );

    const contentContainerStyle = [
      this.props.horizontal === true && styles.contentContainerHorizontal,
      this.props.contentContainerStyle,
    ];
    if (__DEV__ && this.props.style !== undefined) {
      const style = flattenStyle(this.props.style);
      const childLayoutProps = ["alignItems", "justifyContent"].filter(
        (prop) => style && style[prop] !== undefined
      );
      invariant(
        childLayoutProps.length === 0,
        "ScrollView child layout (" +
          JSON.stringify(childLayoutProps) +
          ") must be applied through the contentContainerStyle prop."
      );
    }

    let contentSizeChangeProps = {};
    if (this.props.onContentSizeChange) {
      contentSizeChangeProps = {
        onLayout: this._handleContentOnLayout,
      };
    }

    const { stickyHeaderIndices } = this.props;
    let children = this.props.children;

    if (stickyHeaderIndices != null && stickyHeaderIndices.length > 0) {
      const childArray = React.Children.toArray(this.props.children);

      children = childArray.map((child, index) => {
        const indexOfIndex = child ? stickyHeaderIndices.indexOf(index) : -1;
        if (indexOfIndex > -1) {
          const key = (child as any).key;
          const nextIndex = stickyHeaderIndices[indexOfIndex + 1];
          const prevIndex = stickyHeaderIndices[indexOfIndex - 1];
          const nextKey = this._getKeyForIndex(nextIndex, childArray);
          const prevKey = this._getKeyForIndex(prevIndex, childArray);
          const prevLayoutY = this._headerLayoutYs.get(prevKey);
          const prevLayoutHeight = this._headerLayoutHeights.get(prevKey);
          let prevHeaderLayoutY: number | undefined = undefined;
          if (prevLayoutY != null && prevLayoutHeight != null) {
            prevHeaderLayoutY = prevLayoutY + prevLayoutHeight;
          }

          const StickyHeaderComponent =
            this.props.StickyHeaderComponent || ScrollViewStickyHeader;
          return (
            <StickyHeaderComponent
              key={key}
              nativeID={"StickyHeader-" + key} /* TODO: T68258846. */
              ref={(ref: any) => this._setStickyHeaderRef(key, ref)}
              nextHeaderLayoutY={this._headerLayoutYs.get(nextKey)}
              prevHeaderLayoutY={prevHeaderLayoutY}
              onLayout={(event: any) =>
                this._onStickyHeaderLayout(index, event, key)
              }
              scrollAnimatedValue={this._scrollAnimatedValue}
              inverted={this.props.invertStickyHeaders}
              scrollViewHeight={this.state.layoutHeight}
            >
              {child}
            </StickyHeaderComponent>
          );
        } else {
          return child;
        }
      });
    }
    children = (
      <ScrollViewContext.Provider
        value={this.props.horizontal === true ? HORIZONTAL : VERTICAL}
      >
        {children}
      </ScrollViewContext.Provider>
    );

    const hasStickyHeaders =
      Array.isArray(stickyHeaderIndices) && stickyHeaderIndices.length > 0;

    const contentContainer = (
      /* $FlowFixMe(>=0.112.0 site=react_native_fb) This comment suppresses an
       * error found when Flow v0.112 was deployed. To see the error, delete
       * this comment and run Flow. */
      <ScrollContentContainerViewClass
        {...contentSizeChangeProps}
        ref={this._setInnerViewRef}
        style={contentContainerStyle}
        removeClippedSubviews={
          // Subview clipping causes issues with sticky headers on Android and
          // would be hard to fix properly in a performant way.
          Platform.OS === "android" && hasStickyHeaders
            ? false
            : this.props.removeClippedSubviews
        }
        collapsable={false}
      >
        {children}
      </ScrollContentContainerViewClass>
    );

    const alwaysBounceHorizontal =
      this.props.alwaysBounceHorizontal !== undefined
        ? this.props.alwaysBounceHorizontal
        : this.props.horizontal;

    const alwaysBounceVertical =
      this.props.alwaysBounceVertical !== undefined
        ? this.props.alwaysBounceVertical
        : !this.props.horizontal;

    const baseStyle =
      this.props.horizontal === true
        ? styles.baseHorizontal
        : styles.baseVertical;
    const props = {
      ...this.props,
      alwaysBounceHorizontal,
      alwaysBounceVertical,
      style: [baseStyle, this.props.style],
      // Override the onContentSizeChange from props, since this event can
      // bubble up from TextInputs
      onContentSizeChange: null,
      onLayout: this._handleLayout,
      onMomentumScrollBegin: this._handleMomentumScrollBegin,
      onMomentumScrollEnd: this._handleMomentumScrollEnd,
      onResponderGrant: this._handleResponderGrant,
      onResponderReject: this._handleResponderReject,
      onResponderRelease: this._handleResponderRelease,
      onResponderTerminationRequest: this._handleResponderTerminationRequest,
      onScrollBeginDrag: this._handleScrollBeginDrag,
      onScrollEndDrag: this._handleScrollEndDrag,
      onScrollShouldSetResponder: this._handleScrollShouldSetResponder,
      onStartShouldSetResponder: this._handleStartShouldSetResponder,
      onStartShouldSetResponderCapture:
        this._handleStartShouldSetResponderCapture,
      onTouchEnd: this._handleTouchEnd,
      onTouchMove: this._handleTouchMove,
      onTouchStart: this._handleTouchStart,
      onTouchCancel: this._handleTouchCancel,
      onScroll: this._handleScroll,
      scrollBarThumbImage: resolveAssetSource(this.props.scrollBarThumbImage),
      scrollEventThrottle: hasStickyHeaders
        ? 1
        : this.props.scrollEventThrottle,
      sendMomentumEvents:
        this.props.onMomentumScrollBegin || this.props.onMomentumScrollEnd
          ? true
          : false,
      // default to true
      snapToStart: this.props.snapToStart !== false,
      // default to true
      snapToEnd: this.props.snapToEnd !== false,
      // pagingEnabled is overridden by snapToInterval / snapToOffsets
      pagingEnabled: Platform.select({
        // on iOS, pagingEnabled must be set to false to have snapToInterval / snapToOffsets work
        ios:
          this.props.pagingEnabled === true &&
          this.props.snapToInterval == null &&
          this.props.snapToOffsets == null,
        // on Android, pagingEnabled must be set to true to have snapToInterval / snapToOffsets work
        android:
          this.props.pagingEnabled === true ||
          this.props.snapToInterval != null ||
          this.props.snapToOffsets != null,
      }),
    };

    const { decelerationRate } = this.props;
    if (decelerationRate != null) {
      props.decelerationRate = processDecelerationRate(decelerationRate);
    }

    const refreshControl = this.props.refreshControl;

    if (refreshControl) {
      if (Platform.OS === "ios") {
        // On iOS the RefreshControl is a child of the ScrollView.
        return (
          /* $FlowFixMe(>=0.117.0 site=react_native_fb) This comment suppresses
           * an error found when Flow v0.117 was deployed. To see the error,
           * delete this comment and run Flow. */
          <ScrollViewClass {...props} ref={this._setNativeRef}>
            {refreshControl}
            {contentContainer}
          </ScrollViewClass>
        );
      } else if (Platform.OS === "android") {
        // On Android wrap the ScrollView with a AndroidSwipeRefreshLayout.
        // Since the ScrollView is wrapped add the style props to the
        // AndroidSwipeRefreshLayout and use flex: 1 for the ScrollView.
        // Note: we should split props.style on the inner and outer props
        // however, the ScrollView still needs the baseStyle to be scrollable
        const { outer, inner } = splitLayoutProps(flattenStyle(props.style));
        return React.cloneElement(
          refreshControl,
          { style: [baseStyle, outer] },
          <ScrollViewClass
            {...props}
            style={[baseStyle, inner]}
            ref={this._setNativeRef}
          >
            {contentContainer}
          </ScrollViewClass>
        );
      }
    }
    return (
      <ScrollViewClass {...props} ref={this._setNativeRef}>
        {contentContainer}
      </ScrollViewClass>
    );
  }
}

function Wrapper(props: Props, ref: any) {
  return <ScrollView {...props} scrollViewRef={ref} />;
}
Wrapper.displayName = "ScrollView";
const ForwardedScrollView = React.forwardRef(Wrapper);

// $FlowFixMe Add static context to ForwardedScrollView
(ForwardedScrollView as any).Context = ScrollViewContext;
ForwardedScrollView.displayName = "ScrollView";

export default ForwardedScrollView;
