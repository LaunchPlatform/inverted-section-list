import invariant from "invariant";
import React, {
  ElementRef,
  Component,
  Context,
  PropsWithChildren,
} from "react";
import {
  Animated,
  Platform,
  ScrollViewProps,
  StyleSheet,
  flattenStyle,
  EventSubscription,
  View,
  LayoutChangeEvent,
  findNodeHandle,
  HostComponent,
  Keyboard,
  Dimensions,
} from "react-native";

const {
  default: ScrollViewContext,
  HORIZONTAL,
  VERTICAL,
} = require("react-native/Libraries/Components/ScrollView/ScrollViewContext");
const ScrollResponder =
  require("react-native/Libraries/Components/ScrollView/ScrollResponder").default;
const {
  default: setAndForwardRef,
} = require("react-native/Libraries/Utilities/setAndForwardRef");

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

let AndroidScrollView;
let AndroidHorizontalScrollContentView;
let AndroidHorizontalScrollView;
let RCTScrollView;
let RCTScrollContentView;

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
  getScrollResponder: $PropertyType<ScrollView, "getScrollResponder">;
  getScrollableNode: $PropertyType<ScrollView, "getScrollableNode">;
  getInnerViewNode: $PropertyType<ScrollView, "getInnerViewNode">;
  getInnerViewRef: $PropertyType<ScrollView, "getInnerViewRef">;
  getNativeScrollRef: $PropertyType<ScrollView, "getNativeScrollRef">;
  scrollTo: $PropertyType<ScrollView, "scrollTo">;
  scrollToEnd: $PropertyType<ScrollView, "scrollToEnd">;
  flashScrollIndicators: $PropertyType<ScrollView, "flashScrollIndicators">;

  // ScrollResponder.Mixin public methods
  scrollResponderZoomTo: $PropertyType<
    typeof ScrollResponder.Mixin,
    "scrollResponderZoomTo"
  >;
  scrollResponderScrollNativeHandleToKeyboard: $PropertyType<
    typeof ScrollResponder.Mixin,
    "scrollResponderScrollNativeHandleToKeyboard"
  >;
}

export type ScrollResponderType = ScrollViewImperativeMethods;

export type Props = ScrollViewProps;

type State = {
  layoutHeight: number | null;
};

function createScrollResponder(
  node: React.ElementRef<typeof ScrollView>
): typeof ScrollResponder.Mixin {
  const scrollResponder = { ...ScrollResponder.Mixin };

  for (const key in scrollResponder) {
    if (typeof scrollResponder[key] === "function") {
      scrollResponder[key] = scrollResponder[key].bind(node);
    }
  }

  return scrollResponder;
}

export type ScrollViewStickyHeaderProps = PropsWithChildren<{
  nextHeaderLayoutY: number;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue: Animated.Value;
  // The height of the parent ScrollView. Currently only set when inverted.
  scrollViewHeight: number;
  nativeID?: string;
  hiddenOnScroll?: boolean;
}>;

type StickyHeaderComponentType = React.Component<ScrollViewStickyHeaderProps>;

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

// Mostly copied from
// https://github.com/facebook/react-native/blob/757bb75fbf837714725d7b2af62149e8e2a7ee51/Libraries/Components/ScrollView/ScrollView.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
export default class ScrollView extends Component<Props, State> {
  static Context: typeof ScrollViewContext = ScrollViewContext;

  /**
   * Part 1: Removing ScrollResponder.Mixin:
   *
   * 1. Mixin methods should be flow typed. That's why we create a
   *    copy of ScrollResponder.Mixin and attach it to this._scrollResponder.
   *    Otherwise, we'd have to manually declare each method on the component
   *    class and assign it a flow type.
   * 2. Mixin methods can call component methods, and access the component's
   *    props and state. So, we need to bind all mixin methods to the
   *    component instance.
   * 3. Continued...
   */
  _scrollResponder: typeof ScrollResponder.Mixin = createScrollResponder(this);

  constructor(props: Props) {
    super(props);

    /**
     * Part 2: Removing ScrollResponder.Mixin
     *
     * 3. Mixin methods access other mixin methods via dynamic dispatch using
     *    this. Since mixin methods are bound to the component instance, we need
     *    to copy all mixin methods to the component instance. This is also
     *    necessary because getScrollResponder() is a public method that returns
     *    an object that can be used to execute all scrollResponder methods.
     *    Since the object returned from that method is the ScrollView instance,
     *    we need to bind all mixin methods to the ScrollView instance.
     */
    for (const key in ScrollResponder.Mixin) {
      if (
        typeof ScrollResponder.Mixin[key] === "function" &&
        key.startsWith("scrollResponder")
      ) {
        // $FlowFixMe - dynamically adding properties to a class
        (this as any)[key] = ScrollResponder.Mixin[key].bind(this);
      }
    }

    /**
     * Part 3: Removing ScrollResponder.Mixin
     *
     * 4. Mixins can initialize properties and use properties on the component
     *    instance.
     */
    Object.keys(ScrollResponder.Mixin)
      .filter((key) => typeof ScrollResponder.Mixin[key] !== "function")
      .forEach((key) => {
        // $FlowFixMe - dynamically adding properties to a class
        (this as any)[key] = ScrollResponder.Mixin[key];
      });
  }

  private _scrollAnimatedValue: Animated.Value = new Animated.Value(0);
  private _scrollAnimatedValueAttachment: { detach: () => void } | null = null;
  private _stickyHeaderRefs: Map<
    string,
    React.ElementRef<StickyHeaderComponentType>
  > = new Map();
  private _headerLayoutYs: Map<string, number> = new Map();

  state: State = {
    layoutHeight: null,
    ...ScrollResponder.Mixin.scrollResponderMixinGetInitialState(),
  };

  UNSAFE_componentWillMount() {
    this._scrollResponder.UNSAFE_componentWillMount();
    this._scrollAnimatedValue = new Animated.Value(
      this.props.contentOffset?.y ?? 0
    );
    this._scrollAnimatedValue.setOffset(this.props.contentInset?.top ?? 0);
    this._stickyHeaderRefs = new Map();
    this._headerLayoutYs = new Map();
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
    this._scrollResponder.componentWillUnmount();
    if (this._scrollAnimatedValueAttachment) {
      this._scrollAnimatedValueAttachment.detach();
    }
  }

  _setNativeRef = setAndForwardRef({
    getForwardedRef: () => this.props.scrollViewRef,
    setLocalRef: (ref) => {
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

        // $FlowFixMe - This method was manually bound from ScrollResponder.mixin
        ref.scrollResponderZoomTo = this.scrollResponderZoomTo;
        // $FlowFixMe - This method was manually bound from ScrollResponder.mixin
        ref.scrollResponderScrollNativeHandleToKeyboard =
          this.scrollResponderScrollNativeHandleToKeyboard;
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

  getNativeScrollRef: () => React.ElementRef<HostComponent<mixed>> | null =
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
    this._scrollResponder.scrollResponderScrollTo({
      x: x || 0,
      y: y || 0,
      animated: animated !== false,
    });
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
    this._scrollResponder.scrollResponderScrollToEnd({
      animated: animated,
    });
  };

  /**
   * Displays the scroll indicators momentarily.
   *
   * @platform ios
   */
  flashScrollIndicators: () => void = () => {
    this._scrollResponder.scrollResponderFlashScrollIndicators();
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
      this._scrollAnimatedValueAttachment = Animated.attachNativeEvent(
        this._scrollViewRef,
        "onScroll",
        [{ nativeEvent: { contentOffset: { y: this._scrollAnimatedValue } } }]
      );
    }
  }

  private _setStickyHeaderRef(
    key: string,
    ref: React.ElementRef<StickyHeaderComponentType> | null
  ) {
    if (ref) {
      this._stickyHeaderRefs.set(key, ref);
    } else {
      this._stickyHeaderRefs.delete(key);
    }
  }

  private _onStickyHeaderLayout(index, event, key) {
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
    this._headerLayoutYs.set(key, layoutY);

    const indexOfIndex = stickyHeaderIndices.indexOf(index);
    const previousHeaderIndex = stickyHeaderIndices[indexOfIndex - 1];
    if (previousHeaderIndex != null) {
      const previousHeader = this._stickyHeaderRefs.get(
        this._getKeyForIndex(previousHeaderIndex, childArray)
      );
      previousHeader &&
        previousHeader.setNextHeaderY &&
        previousHeader.setNextHeaderY(layoutY);
    }
  }

  private _handleScroll = (e: ScrollEvent) => {
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
      if (
        this.props.keyboardDismissMode === "on-drag" &&
        this.state.isTouching
      ) {
        dismissKeyboard();
      }
    }
    this._scrollResponder.scrollResponderHandleScroll(e);
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

  _scrollViewRef: React.ElementRef<HostComponent<mixed>> | null = null;

  _innerViewRef: React.ElementRef<typeof View> | null = null;
  _setInnerViewRef = setAndForwardRef({
    getForwardedRef: () => this.props.innerViewRef,
    setLocalRef: (ref) => {
      this._innerViewRef = ref;
    },
  });

  render(): React.Node | React.Element<string> {
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
          const key = child.key;
          const nextIndex = stickyHeaderIndices[indexOfIndex + 1];
          const StickyHeaderComponent =
            this.props.StickyHeaderComponent || ScrollViewStickyHeader;
          return (
            <StickyHeaderComponent
              key={key}
              nativeID={"StickyHeader-" + key} /* TODO: T68258846. */
              ref={(ref) => this._setStickyHeaderRef(key, ref)}
              nextHeaderLayoutY={this._headerLayoutYs.get(
                this._getKeyForIndex(nextIndex, childArray)
              )}
              onLayout={(event) =>
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
      onMomentumScrollBegin:
        this._scrollResponder.scrollResponderHandleMomentumScrollBegin,
      onMomentumScrollEnd:
        this._scrollResponder.scrollResponderHandleMomentumScrollEnd,
      onResponderGrant:
        this._scrollResponder.scrollResponderHandleResponderGrant,
      onResponderReject:
        this._scrollResponder.scrollResponderHandleResponderReject,
      onResponderRelease:
        this._scrollResponder.scrollResponderHandleResponderRelease,
      onResponderTerminationRequest:
        this._scrollResponder.scrollResponderHandleTerminationRequest,
      onScrollBeginDrag:
        this._scrollResponder.scrollResponderHandleScrollBeginDrag,
      onScrollEndDrag: this._scrollResponder.scrollResponderHandleScrollEndDrag,
      onScrollShouldSetResponder:
        this._scrollResponder.scrollResponderHandleScrollShouldSetResponder,
      onStartShouldSetResponder:
        this._scrollResponder.scrollResponderHandleStartShouldSetResponder,
      onStartShouldSetResponderCapture:
        this._scrollResponder
          .scrollResponderHandleStartShouldSetResponderCapture,
      onTouchEnd: this._scrollResponder.scrollResponderHandleTouchEnd,
      onTouchMove: this._scrollResponder.scrollResponderHandleTouchMove,
      onTouchStart: this._scrollResponder.scrollResponderHandleTouchStart,
      onTouchCancel: this._scrollResponder.scrollResponderHandleTouchCancel,
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
