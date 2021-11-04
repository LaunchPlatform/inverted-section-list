import invariant from "invariant";
import React, { ElementRef, Component, PropsWithChildren } from "react";
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
  Keyboard,
} from "react-native";

const AndroidHorizontalScrollViewNativeComponent =
  require("react-native/Libraries/Components/ScrollView/AndroidHorizontalScrollViewNativeComponent").default;
const AndroidHorizontalScrollContentViewNativeComponent =
  require("react-native/Libraries/Components/ScrollView/AndroidHorizontalScrollContentViewNativeComponent").default;
const ScrollViewNativeComponent =
  require("react-native/Libraries/Components/ScrollView/ScrollViewNativeComponent").default;
const ScrollContentViewNativeComponent =
  require("react-native/Libraries/Components/ScrollView/ScrollContentViewNativeComponent").default;

export type Props = ScrollViewProps;

type State = {
  layoutHeight: number | null;
};

export type ScrollViewStickyHeaderProps = PropsWithChildren<{
  nextHeaderLayoutY: number;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue: Animated.Value;
  // The height of the parent ScrollView. Currently only set when inverted.
  scrollViewHeight: number;
  nativeID?: string;
  hiddenOnScroll?: boolean;
}>;

type StickyHeaderComponentType = Component<ScrollViewStickyHeaderProps>;

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

const { NativeHorizontalScrollViewTuple, NativeVerticalScrollViewTuple } =
  Platform.OS === "android"
    ? {
        NativeHorizontalScrollViewTuple: [
          AndroidHorizontalScrollViewNativeComponent,
          AndroidHorizontalScrollContentViewNativeComponent,
        ],
        NativeVerticalScrollViewTuple: [ScrollViewNativeComponent, View],
      }
    : {
        NativeHorizontalScrollViewTuple: [
          ScrollViewNativeComponent,
          ScrollContentViewNativeComponent,
        ],
        NativeVerticalScrollViewTuple: [
          ScrollViewNativeComponent,
          ScrollContentViewNativeComponent,
        ],
      };

// Mostly copied from
// https://github.com/facebook/react-native/blob/86491749ee67562e424209f644f7273061633687/Libraries/Components/ScrollView/ScrollView.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
export default class ScrollView extends Component<Props, State> {
  private _scrollAnimatedValue: Animated.Value;
  private _scrollAnimatedValueAttachment: { detach: () => void } = null;
  private _stickyHeaderRefs: Map<
    string,
    React.ElementRef<StickyHeaderComponentType>
  > = new Map();
  private _headerLayoutYs: Map<string, number> = new Map();

  _keyboardWillOpenTo: KeyboardEvent = null;
  _additionalScrollOffset: number = 0;
  _isTouching: boolean = false;
  _lastMomentumScrollBeginTime: number = 0;
  _lastMomentumScrollEndTime: number = 0;

  // Reset to false every time becomes responder. This is used to:
  // - Determine if the scroll view has been scrolled and therefore should
  // refuse to give up its responder lock.
  // - Determine if releasing should dismiss the keyboard when we are in
  // tap-to-dismiss mode (this.props.keyboardShouldPersistTaps !== 'always').
  _observedScrollSinceBecomingResponder: boolean = false;
  _becameResponderWhileAnimating: boolean = false;
  _preventNegativeScrollOffset: boolean | null = null;

  _animated = null;

  _subscriptionKeyboardWillShow: EventSubscription | null = null;
  _subscriptionKeyboardWillHide: EventSubscription | null = null;
  _subscriptionKeyboardDidShow: EventSubscription | null = null;
  _subscriptionKeyboardDidHide: EventSubscription | null = null;

  state: State = {
    layoutHeight: null,
  };

  constructor(props: Props) {
    super(props);

    this._scrollAnimatedValue = new Animated.Value(
      this.props.contentOffset?.y ?? 0
    );
    this._scrollAnimatedValue.setOffset(this.props.contentInset?.top ?? 0);
  }

  componentDidMount() {
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

    this._updateAnimatedNodeAttachment();
  }

  componentDidUpdate(prevProps: Props) {
    const prevContentInsetTop = prevProps.contentInset
      ? prevProps.contentInset.top
      : 0;
    const newContentInsetTop = this.props.contentInset
      ? this.props.contentInset.top
      : 0;
    if (prevContentInsetTop !== newContentInsetTop) {
      this._scrollAnimatedValue.setOffset(newContentInsetTop || 0);
    }

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

  private _setNativeRef = setAndForwardRef({
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
        ref.scrollResponderZoomTo = this.scrollResponderZoomTo;
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
    if (this._scrollViewRef == null) {
      return;
    }
    Commands.scrollTo(this._scrollViewRef, x || 0, y || 0, animated !== false);
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
    Commands.scrollToEnd(this._scrollViewRef, animated);
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
    Commands.flashScrollIndicators(this._scrollViewRef);
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
  scrollResponderScrollNativeHandleToKeyboard: <T>(
    nodeHandle: number | React.ElementRef<HostComponent<T>>,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean
  ) => void = (
    nodeHandle: number | React.ElementRef<HostComponent<T>>,
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
        ReactNative.findNodeHandle(this),
        // $FlowFixMe[method-unbinding] added when improving typing for this parameters
        this._textInputFocusError,
        this._inputMeasureAndScrollToKeyboard
      );
    } else {
      nodeHandle.measureLayout(
        this._innerViewRef,
        this._inputMeasureAndScrollToKeyboard,
        // $FlowFixMe[method-unbinding] added when improving typing for this parameters
        this._textInputFocusError
      );
    }
  };

  private _handleContentOnLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    this.props.onContentSizeChange &&
      this.props.onContentSizeChange(width, height);
  };

  private _setStickyHeaderRef(
    key: string,
    ref: React.ElementRef<StickyHeaderComponentType>
  ) {
    if (ref) {
      this._stickyHeaderRefs.set(key, ref);
    } else {
      this._stickyHeaderRefs.delete(key);
    }
  }

  private _getKeyForIndex(index: number, childArray: Array<any>) {
    const child = childArray[index];
    return child && child.key;
  }

  render() {
    const [NativeDirectionalScrollView, NativeDirectionalScrollContentView] =
      this.props.horizontal === true
        ? NativeHorizontalScrollViewTuple
        : NativeVerticalScrollViewTuple;

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

    const contentSizeChangeProps =
      this.props.onContentSizeChange == null
        ? null
        : {
            onLayout: this._handleContentOnLayout,
          };

    const { stickyHeaderIndices } = this.props;
    let children = this.props.children;

    if (stickyHeaderIndices != null && stickyHeaderIndices.length > 0) {
      const childArray = React.Children.toArray(this.props.children);

      children = childArray.map((child, index) => {
        const indexOfIndex = child ? stickyHeaderIndices.indexOf(index) : -1;
        if (indexOfIndex > -1) {
          const key = (child as any).key;
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
              hiddenOnScroll={this.props.stickyHeaderHiddenOnScroll}
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
      <NativeDirectionalScrollContentView
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
      </NativeDirectionalScrollContentView>
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
      style: StyleSheet.compose(baseStyle, this.props.style),
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
          <NativeDirectionalScrollView {...props} ref={this._setNativeRef}>
            {refreshControl}
            {contentContainer}
          </NativeDirectionalScrollView>
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
          { style: StyleSheet.compose(baseStyle, outer) },
          <NativeDirectionalScrollView
            {...props}
            style={StyleSheet.compose(baseStyle, inner)}
            ref={this._setNativeRef}
          >
            {contentContainer}
          </NativeDirectionalScrollView>
        );
      }
    }
    return (
      <NativeDirectionalScrollView {...props} ref={this._setNativeRef}>
        {contentContainer}
      </NativeDirectionalScrollView>
    );
  }
}
