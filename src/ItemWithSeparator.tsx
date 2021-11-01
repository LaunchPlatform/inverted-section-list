import { ComponentType, PropsWithChildren, useEffect, useState } from "react";
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
  updateHighlightFor: (prevCellKey: string, value: boolean) => void;
  updatePropsFor: (prevCellKey: string, value: Record<string, any>) => void;
  renderItem: Function;
  inverted: boolean;
}

const ItemWithSeparator = <ItemT, SectionT>(
  props: PropsWithChildren<Props<ItemT, SectionT>>
) => {
  const {
    LeadingSeparatorComponent,
    // this is the trailing separator and is associated with this item
    SeparatorComponent,
    cellKey,
    prevCellKey,
    setSelfHighlightCallback,
    updateHighlightFor,
    setSelfUpdatePropsCallback,
    updatePropsFor,
    item,
    index,
    section,
    inverted,
  } = props;

  const [leadingSeparatorHiglighted, setLeadingSeparatorHighlighted] =
    useState(false);

  const [separatorHighlighted, setSeparatorHighlighted] = useState(false);

  const [leadingSeparatorProps, setLeadingSeparatorProps] = useState({
    leadingItem: props.leadingItem,
    leadingSection: props.leadingSection,
    section: props.section,
    trailingItem: props.item,
    trailingSection: props.trailingSection,
  });
  const [separatorProps, setSeparatorProps] = useState<
    CommonProps<ItemT, SectionT>
  >({
    leadingItem: props.item,
    leadingSection: props.leadingSection,
    section: props.section,
    trailingItem: props.trailingItem,
    trailingSection: props.trailingSection,
  });

  useEffect(() => {
    setSelfHighlightCallback(cellKey, setSeparatorHighlighted);
    setSelfUpdatePropsCallback(cellKey, setSeparatorProps);

    return () => {
      setSelfUpdatePropsCallback(cellKey, null);
      setSelfHighlightCallback(cellKey, null);
    };
  }, [
    cellKey,
    setSelfHighlightCallback,
    setSeparatorProps,
    setSelfUpdatePropsCallback,
  ]);

  const separators = {
    highlight: () => {
      setLeadingSeparatorHighlighted(true);
      setSeparatorHighlighted(true);
      if (prevCellKey != null) {
        updateHighlightFor(prevCellKey, true);
      }
    },
    unhighlight: () => {
      setLeadingSeparatorHighlighted(false);
      setSeparatorHighlighted(false);
      if (prevCellKey != null) {
        updateHighlightFor(prevCellKey, false);
      }
    },
    updateProps: (
      select: "leading" | "trailing",
      newProps: CommonProps<ItemT, SectionT>
    ) => {
      if (select === "leading") {
        if (
          LeadingSeparatorComponent !== null &&
          LeadingSeparatorComponent !== undefined
        ) {
          setLeadingSeparatorProps({ ...leadingSeparatorProps, ...newProps });
        } else if (prevCellKey != null) {
          // update the previous item's separator
          updatePropsFor(prevCellKey, {
            ...leadingSeparatorProps,
            ...newProps,
          });
        }
      } else if (select === "trailing" && SeparatorComponent !== undefined) {
        setSeparatorProps({ ...separatorProps, ...newProps });
      }
    },
  };
  const element = props.renderItem({
    item,
    index,
    section,
    separators,
  });
  const leadingSeparator = LeadingSeparatorComponent !== null &&
    LeadingSeparatorComponent !== undefined && (
      <LeadingSeparatorComponent
        highlighted={leadingSeparatorHiglighted}
        {...leadingSeparatorProps}
      />
    );
  const separator = SeparatorComponent != null && (
    <SeparatorComponent
      highlighted={separatorHighlighted}
      {...separatorProps}
    />
  );
  return leadingSeparator || separator ? (
    <View>
      {inverted === false ? leadingSeparator : separator}
      {element}
      {inverted === false ? separator : leadingSeparator}
    </View>
  ) : (
    element
  );
};

export default ItemWithSeparator;
