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
