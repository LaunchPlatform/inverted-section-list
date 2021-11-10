import React, { Component, ComponentType, ForwardedRef } from "react";
import { View } from "react-native";

interface CommonProps<ItemT, SectionT> {
  readonly section: SectionT;
  readonly leadingSection?: SectionT;
  readonly trailingSection?: SectionT;
  readonly leadingItem?: ItemT;
  readonly trailingItem?: ItemT;
}

export interface Props<ItemT, SectionT> extends CommonProps<ItemT, SectionT> {
  LeadingSeparatorComponent?: ComponentType<any> | null;
  SeparatorComponent?: ComponentType<any> | null;
  ref?: ForwardedRef<any>;
  cellKey: string;
  index: number;
  item: ItemT;
  setSelfHighlightCallback: (
    cellKey: string,
    updateFn?: ((hightlight: boolean) => void) | null
  ) => void;
  setSelfUpdatePropsCallback: (
    cellKey: string,
    updateFn?: ((props: CommonProps<ItemT, SectionT>) => void) | null
  ) => void;
  prevCellKey?: string;
  onUpdateSeparator: (cellKey: string, newProps: any) => void;
  updateHighlightFor: (prevCellKey: string, value: boolean) => void;
  updatePropsFor: (prevCellKey: string, value: Record<string, any>) => void;
  renderItem: Function;
  inverted: boolean;
}

interface State<ItemT, SectionT> {
  separatorProps: {
    highlighted: false;
  } & CommonProps<ItemT, SectionT>;
  leadingSeparatorProps: {
    highlighted: false;
  } & CommonProps<ItemT, SectionT>;
}

// Mostly copied from
// https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizedSectionList.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
class ItemWithSeparator<ItemT, SectionT> extends Component<
  Props<ItemT, SectionT>,
  State<ItemT, SectionT>
> {
  state: State<ItemT, SectionT> = {
    separatorProps: {
      highlighted: false,
      leadingItem: this.props.item,
      leadingSection: this.props.leadingSection,
      section: this.props.section,
      trailingItem: this.props.trailingItem,
      trailingSection: this.props.trailingSection,
    },
    leadingSeparatorProps: {
      highlighted: false,
      leadingItem: this.props.leadingItem,
      leadingSection: this.props.leadingSection,
      section: this.props.section,
      trailingItem: this.props.item,
      trailingSection: this.props.trailingSection,
    },
  };

  _separators = {
    highlight: () => {
      (["leading", "trailing"] as const).forEach((s) =>
        this._separators.updateProps(s, { highlighted: true })
      );
    },
    unhighlight: () => {
      (["leading", "trailing"] as const).forEach((s: "leading" | "trailing") =>
        this._separators.updateProps(s, { highlighted: false })
      );
    },
    updateProps: (select: "leading" | "trailing", newProps: any) => {
      const { LeadingSeparatorComponent, cellKey, prevCellKey } = this.props;
      if (select === "leading" && LeadingSeparatorComponent != null) {
        this.setState((state: State<ItemT, SectionT>) => ({
          leadingSeparatorProps: {
            ...state.leadingSeparatorProps,
            ...newProps,
          },
        }));
      } else {
        this.props.onUpdateSeparator(
          (select === "leading" && prevCellKey) || cellKey,
          newProps
        );
      }
    },
  };

  static getDerivedStateFromProps(
    props: Props<any, any>,
    prevState: State<any, any>
  ): State<any, any> | null {
    return {
      separatorProps: {
        ...prevState.separatorProps,
        leadingItem: props.item,
        leadingSection: props.leadingSection,
        section: props.section,
        trailingItem: props.trailingItem,
        trailingSection: props.trailingSection,
      },
      leadingSeparatorProps: {
        ...prevState.leadingSeparatorProps,
        leadingItem: props.leadingItem,
        leadingSection: props.leadingSection,
        section: props.section,
        trailingItem: props.item,
        trailingSection: props.trailingSection,
      },
    };
  }

  updateSeparatorProps(newProps: Object) {
    this.setState((state: State<ItemT, SectionT>) => ({
      separatorProps: { ...state.separatorProps, ...newProps },
    }));
  }

  render() {
    const {
      LeadingSeparatorComponent,
      SeparatorComponent,
      item,
      index,
      section,
      inverted,
    } = this.props;
    const element = this.props.renderItem({
      item,
      index,
      section,
      separators: this._separators,
    });
    const leadingSeparator = LeadingSeparatorComponent && (
      <LeadingSeparatorComponent {...this.state.leadingSeparatorProps} />
    );
    const separator = SeparatorComponent && (
      <SeparatorComponent {...this.state.separatorProps} />
    );
    return leadingSeparator || separator ? (
      /* $FlowFixMe(>=0.89.0 site=react_native_fb) This comment suppresses an
       * error found when Flow v0.89 was deployed. To see the error, delete
       * this comment and run Flow. */
      <View>
        {!inverted ? leadingSeparator : separator}
        {element}
        {!inverted ? separator : leadingSeparator}
      </View>
    ) : (
      element
    );
  }
}

export default ItemWithSeparator;
