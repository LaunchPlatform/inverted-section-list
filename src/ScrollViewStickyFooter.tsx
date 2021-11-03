import React, { Component, PropsWithChildren, RefObject } from "react";
import {
  Animated,
  LayoutChangeEvent,
  Platform,
  StyleSheet,
} from "react-native";

const styles = StyleSheet.create({
  header: {
    zIndex: 10,
    position: "relative",
  },
  fill: {
    flex: 1,
  },
});

export type Props = PropsWithChildren<{
  nextHeaderLayoutY: number;
  onLayout: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue: Animated.Value;
  // The height of the parent ScrollView. Currently only set when inverted.
  scrollViewHeight: number;
  nativeID?: string;
  hiddenOnScroll?: boolean;
}>;

type State = {
  measured: boolean;
  layoutY: number;
  layoutHeight: number;
  nextHeaderLayoutY: number;
  prevHeaderLayoutY: number | null;
  translateY: number | null;
};

// Mostly copied from
// https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Components/ScrollView/ScrollViewStickyHeader.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
export default class ScrollViewStickyFooter extends Component<Props, State> {
  public state: Readonly<State> = {
    measured: false,
    layoutY: 0,
    layoutHeight: 0,
    nextHeaderLayoutY: this.props.nextHeaderLayoutY,
    prevHeaderLayoutY: null,
    translateY: null,
  };

  private _translateY: Animated.AnimatedNode | null = null;
  private _shouldRecreateTranslateY: boolean = true;
  private _haveReceivedInitialZeroTranslateY: boolean = true;
  private _ref: any; // TODO T53738161: flow type this, and the whole file

  // Fabric-only:
  private _timer: number | null = null;
  private _animatedValueListenerId: string | null = null;
  private _animatedValueListener:
    | ((valueObject: Readonly<{ value: number }>) => void)
    | null = null;
  private _debounceTimeout: number = Platform.OS === "android" ? 15 : 64;

  setNextHeaderY: (y: number) => void = (y: number): void => {
    this._shouldRecreateTranslateY = true;
    this.setState({ nextHeaderLayoutY: y });
  };

  setPrevHeaderY: (y: number | null) => void = (y: number | null): void => {
    this._shouldRecreateTranslateY = true;
    this.setState({ prevHeaderLayoutY: y });
  };

  componentWillUnmount() {
    if (this._translateY !== null && this._animatedValueListenerId !== null) {
      this._translateY.removeListener(this._animatedValueListenerId);
    }
    if (this._timer !== null) {
      clearTimeout(this._timer);
    }
  }

  UNSAFE_componentWillReceiveProps(nextProps: Props) {
    if (
      nextProps.scrollViewHeight !== this.props.scrollViewHeight ||
      nextProps.scrollAnimatedValue !== this.props.scrollAnimatedValue
    ) {
      this._shouldRecreateTranslateY = true;
    }
  }

  updateTranslateListener(
    translateY: Animated.AnimatedInterpolation,
    isFabric: boolean,
    offset: Animated.AnimatedDiffClamp | null
  ) {
    if (this._translateY != null && this._animatedValueListenerId != null) {
      this._translateY.removeListener(this._animatedValueListenerId);
    }
    offset
      ? (this._translateY = Animated.add(translateY, offset))
      : (this._translateY = translateY);

    this._shouldRecreateTranslateY = false;

    if (!isFabric) {
      return;
    }

    if (this._animatedValueListener === null) {
      // This is called whenever the (Interpolated) Animated Value
      // updates, which is several times per frame during scrolling.
      // To ensure that the Fabric ShadowTree has the most recent
      // translate style of this node, we debounce the value and then
      // pass it through to the underlying node during render.
      // This is:
      // 1. Only an issue in Fabric.
      // 2. Worse in Android than iOS. In Android, but not iOS, you
      //    can touch and move your finger slightly and still trigger
      //    a "tap" event. In iOS, moving will cancel the tap in
      //    both Fabric and non-Fabric. On Android when you move
      //    your finger, the hit-detection moves from the Android
      //    platform to JS, so we need the ShadowTree to have knowledge
      //    of the current position.
      this._animatedValueListener = ({ value }) => {
        // When the AnimatedInterpolation is recreated, it always initializes
        // to a value of zero and emits a value change of 0 to its listeners.
        if (value === 0 && !this._haveReceivedInitialZeroTranslateY) {
          this._haveReceivedInitialZeroTranslateY = true;
          return;
        }
        if (this._timer) {
          clearTimeout(this._timer);
        }
        this._timer = setTimeout(() => {
          if (value !== this.state.translateY) {
            this.setState({
              translateY: value,
            });
          }
        }, this._debounceTimeout);
      };
    }
    if (this.state.translateY !== 0 && this.state.translateY != null) {
      this._haveReceivedInitialZeroTranslateY = false;
    }
    this._animatedValueListenerId = translateY.addListener(
      this._animatedValueListener
    );
  }

  _onLayout = (event: LayoutChangeEvent) => {
    const layoutY = event.nativeEvent.layout.y;
    const layoutHeight = event.nativeEvent.layout.height;
    const measured = true;

    if (
      layoutY !== this.state.layoutY ||
      layoutHeight !== this.state.layoutHeight ||
      measured !== this.state.measured
    ) {
      this._shouldRecreateTranslateY = true;
    }

    this.setState({
      measured,
      layoutY,
      layoutHeight,
    });

    this.props.onLayout(event);
    const child = React.Children.only(this.props.children);
    if ((child as any).props.onLayout) {
      (child as any).props.onLayout(event);
    }
  };

  _setComponentRef = (ref: RefObject<typeof Animated.View>) => {
    this._ref = ref;
  };

  render() {
    // Fabric Detection
    const isFabric = !!(
      // An internal transform mangles variables with leading "_" as private.
      // eslint-disable-next-line dot-notation
      (this._ref && this._ref["_internalInstanceHandle"]?.stateNode?.canonical)
    );

    // Initially and in the case of updated props or layout, we
    // recreate this interpolated value. Otherwise, we do not recreate
    // when there are state changes.
    if (this._shouldRecreateTranslateY) {
      const { scrollViewHeight } = this.props;
      const { measured, layoutHeight, layoutY, prevHeaderLayoutY } = this.state;
      let inputRange: Array<number> = [-1, 0];
      let outputRange: Array<number> = [0, 0];

      if (measured) {
        if (scrollViewHeight != null) {
          const stickStartPoint = layoutY + layoutHeight - scrollViewHeight;
          if (stickStartPoint > 0) {
            const prevStickEndPoint =
              (prevHeaderLayoutY || 0) + layoutHeight - scrollViewHeight;
            const delta = stickStartPoint - prevStickEndPoint;
            if (delta > 0) {
              // The interpolate looks like this:
              //
              // ------
              //       \
              //        \            height = delta
              //         \---------
              //  prev^   ^current
              //        ^ width = delta
              //
              // Basically, it starts from `prevStickEndPoint`, where the
              // previous header stops scrolling. Then we starts the sticking by adding
              // negative delta to the `translateY` to cancel the scrolling offset.
              // Until the point, where we have scroll to where the current header's original
              // position, at this point the `translateY` goes down to 0 so that it
              // will scroll with the content
              inputRange = [
                prevStickEndPoint - 1,
                prevStickEndPoint,
                stickStartPoint,
                stickStartPoint + 1,
              ];
              outputRange = [-delta, -delta, 0, 0];
            }
          }
        }
      }

      this.updateTranslateListener(
        this.props.scrollAnimatedValue.interpolate({
          inputRange,
          outputRange,
        }),
        isFabric,
        this.props.hiddenOnScroll
          ? Animated.diffClamp(
              this.props.scrollAnimatedValue
                .interpolate({
                  extrapolateLeft: "clamp",
                  inputRange: [layoutY, layoutY + 1],
                  outputRange: [0, 1],
                })
                .interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -1],
                }),
              -this.state.layoutHeight,
              0
            )
          : null
      );
    }

    const child = React.Children.only(this.props.children);

    // TODO T68319535: remove this if NativeAnimated is rewritten for Fabric
    const passthroughAnimatedPropExplicitValues =
      isFabric && this.state.translateY != null
        ? {
            style: { transform: [{ translateY: this.state.translateY }] },
          }
        : null;

    return (
      <Animated.View
        collapsable={false}
        nativeID={this.props.nativeID}
        onLayout={this._onLayout}
        ref={this._setComponentRef}
        style={[
          (child as any).props.style,
          styles.header,
          { transform: [{ translateY: this._translateY }] },
        ]}
        {...{ passthroughAnimatedPropExplicitValues }}
      >
        {React.cloneElement(child as any, {
          style: styles.fill, // We transfer the child style to the wrapper.
          onLayout: undefined, // we call this manually through our this._onLayout
        })}
      </Animated.View>
    );
  }
}
