import invariant from "invariant";
import React, { Component, ComponentType } from "react";
import {
  Platform,
  SectionBase,
  SectionListProps,
  VirtualizedList,
} from "react-native";
import ItemWithSeparator from "./ItemWithSeparator";

export type Props<ItemT, SectionT extends SectionBase<ItemT, SectionT>> = Omit<
  SectionListProps<ItemT, SectionT>,
  "inverted" | "invertStickyHeaders" | "stickyHeaderIndices" | "getItem"
>;

// ref: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizeUtils.js#L237-L245
function defaultKeyExtractor(item: any, index: number): string {
  if (typeof item === "object" && item?.key != null) {
    return item.key;
  }
  if (typeof item === "object" && item?.id != null) {
    return item.id;
  }
  return String(index);
}

interface SubExtractorResult<
  ItemT,
  SectionT extends SectionBase<ItemT, SectionT>
> {
  readonly section: SectionT;
  readonly key: string;
  readonly index: number | null;
  readonly header?: boolean;
  readonly leadingSection?: SectionT;
  readonly trailingSection?: SectionT;
  readonly leadingItem?: ItemT;
  readonly trailingItem?: ItemT;
}

// Mostly copied from
// https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizedSectionList.js
// and
// https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/SectionList.js
// By Facebook
// MIT License: https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/LICENSE
// We only changes the things needed to be done to make inverted section list sticky header works
export default class InvertedSectionList<
  ItemT,
  SectionT extends SectionBase<ItemT, SectionT>
> extends Component<Props<ItemT, SectionT>> {
  readonly updateHighlightMap: Record<string, (hightlight: boolean) => void> =
    {};
  readonly updatePropsMap: Record<string, (props: any) => void> = {};

  private keyExtractor = (item: ItemT, index: number) => {
    const info = this.subExtractor(index);
    return (info && info.key) || String(index);
  };

  private subExtractor(
    index: number
  ): SubExtractorResult<ItemT, SectionT> | undefined {
    let itemIndex = index;
    const { keyExtractor, sections } = this.props;
    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      const key = section.key || String(i);
      const itemCount = this.getItemCount(section);
      itemIndex -= 1; // The section adds an item for the header
      if (itemIndex >= itemCount + 1) {
        itemIndex -= itemCount + 1; // The section adds an item for the footer.
      } else if (itemIndex === -1) {
        return {
          section,
          key: key + ":header",
          index: null,
          header: true,
          trailingSection: sections[i + 1],
        };
      } else if (itemIndex === itemCount) {
        return {
          section,
          key: key + ":footer",
          index: null,
          header: false,
          trailingSection: sections[i + 1],
        };
      } else {
        const extractor =
          section.keyExtractor || keyExtractor || defaultKeyExtractor;
        return {
          section,
          key:
            key + ":" + extractor(this.getItem(section, itemIndex), itemIndex),
          index: itemIndex,
          leadingItem: this.getItem(section, itemIndex - 1),
          leadingSection: sections[i - 1],
          trailingItem: this.getItem(section, itemIndex + 1),
          trailingSection: sections[i + 1],
        };
      }
    }
  }

  private getSeparatorComponent(
    index: number,
    listItemCount: number,
    info?: SubExtractorResult<ItemT, SectionT>
  ): ComponentType<any> | undefined {
    info = info || this.subExtractor(index);
    if (!info) {
      return undefined;
    }
    const ItemSeparatorComponent =
      (info.section as any).ItemSeparatorComponent ||
      this.props.ItemSeparatorComponent;
    const { SectionSeparatorComponent } = this.props;
    const isLastItemInList = index === listItemCount - 1;
    const isLastItemInSection =
      info.index === this.getItemCount(info.section) - 1;
    if (SectionSeparatorComponent && isLastItemInSection) {
      return SectionSeparatorComponent as ComponentType<any>;
    }
    if (ItemSeparatorComponent && !isLastItemInSection && !isLastItemInList) {
      return ItemSeparatorComponent;
    }
    return undefined;
  }

  private getItemCount(section: SectionT): number {
    return section.data.length;
  }

  private getItem(section: SectionT, index: number): ItemT {
    return section.data[index];
  }

  private getSectionItem = (
    sections: Array<SectionT> | null,
    index: number
  ): ItemT => {
    if (sections === null) {
      return undefined as any;
    }
    let itemIdx = index - 1;
    for (let i = 0; i < sections.length; ++i) {
      const section = sections[i];
      const itemCount = this.getItemCount(section);
      if (itemIdx === -1 || itemIdx === itemCount) {
        // We intend for there to be overflow by one on both ends of the list.
        // This will be for headers and footers. When returning a header or footer
        // item the section itself is the item.
        return section as any as ItemT;
      } else if (itemIdx < itemCount) {
        // If we are in the bounds of the list's data then return the item.
        return this.getItem(section, itemIdx);
      } else {
        itemIdx -= itemCount + 2; // Add two for the header and footer
      }
    }
    return undefined as any;
  };

  private updatePropsFor = (cellKey: string, value: any) => {
    const updateProps = this.updatePropsMap[cellKey];
    if (updateProps != null) {
      updateProps(value);
    }
  };

  private updateHighlightFor = (cellKey: string, value: any) => {
    const updateHighlight = this.updateHighlightMap[cellKey];
    if (updateHighlight != null) {
      updateHighlight(value);
    }
  };

  private setUpdateHighlightFor = (
    cellKey: string,
    updateHighlightFn?: ((highlight: boolean) => void) | null
  ) => {
    if (updateHighlightFn !== undefined && updateHighlightFn !== null) {
      this.updateHighlightMap[cellKey] = updateHighlightFn;
    } else {
      delete this.updateHighlightMap[cellKey];
    }
  };

  private setUpdatePropsFor = (
    cellKey: string,
    updatePropsFn?: ((props: any) => void) | null
  ) => {
    if (updatePropsFn !== undefined && updatePropsFn !== null) {
      this.updatePropsMap[cellKey] = updatePropsFn;
    } else {
      delete this.updatePropsMap[cellKey];
    }
  };

  private renderItem =
    (listItemCount: number) =>
    ({ item, index }: { item: ItemT; index: number }) => {
      const info = this.subExtractor(index);
      if (!info) {
        return null;
      }
      const infoIndex = info.index;
      if (infoIndex === null) {
        const { section } = info;
        if (info.header === true) {
          const { renderSectionHeader } = this.props;
          return renderSectionHeader
            ? renderSectionHeader({ section: section as any })
            : null;
        } else {
          const { renderSectionFooter } = this.props;
          return renderSectionFooter
            ? renderSectionFooter({ section: section as any })
            : null;
        }
      } else {
        const renderItem =
          (info.section as any).renderItem || this.props.renderItem;
        const SeparatorComponent = this.getSeparatorComponent(
          index,
          listItemCount,
          info
        );
        invariant(renderItem, "no renderItem!");
        return (
          <ItemWithSeparator
            SeparatorComponent={SeparatorComponent}
            LeadingSeparatorComponent={
              infoIndex === 0
                ? (this.props.SectionSeparatorComponent as any)
                : undefined
            }
            cellKey={info.key}
            index={infoIndex}
            item={item}
            leadingItem={info.leadingItem}
            leadingSection={info.leadingSection}
            prevCellKey={(this.subExtractor(index - 1) || {}).key}
            // Callback to provide updateHighlight for this item
            setSelfHighlightCallback={this.setUpdateHighlightFor}
            setSelfUpdatePropsCallback={this.setUpdatePropsFor}
            // Provide child ability to set highlight/updateProps for previous item using prevCellKey
            updateHighlightFor={this.updateHighlightFor}
            updatePropsFor={this.updatePropsFor}
            renderItem={renderItem}
            section={info.section}
            trailingItem={info.trailingItem}
            trailingSection={info.trailingSection}
            inverted
          />
        );
      }
    };

  render() {
    const {
      // don't pass through, rendered with renderItem
      ItemSeparatorComponent,
      SectionSeparatorComponent,
      renderItem: _renderItem,
      renderSectionFooter,
      renderSectionHeader,
      sections: _sections,
      stickySectionHeadersEnabled: _stickySectionHeadersEnabled,
      ...passThroughProps
    } = this.props;

    const listHeaderOffset = this.props.ListHeaderComponent ? 1 : 0;
    const stickySectionHeadersEnabled =
      _stickySectionHeadersEnabled ?? Platform.OS === "ios";

    const stickyHeaderIndices: Array<number> | undefined =
      stickySectionHeadersEnabled ? [] : undefined;

    let itemCount = 0;
    for (const section of this.props.sections) {
      const sectionItemCount = this.getItemCount(section);
      // Track the section header indices
      if (stickyHeaderIndices !== undefined) {
        // Notice: this is different from the original VirtualizedSectionList,
        //         since we are actually using footer as the header here, so need to + 1
        //         for the header
        stickyHeaderIndices.push(
          itemCount + listHeaderOffset + sectionItemCount + 1
        );
      }

      // Add two for the section header and footer.
      itemCount += 2;
      itemCount += sectionItemCount;
    }
    const renderItem = this.renderItem(itemCount);

    return (
      <VirtualizedList
        {...passThroughProps}
        keyExtractor={this.keyExtractor}
        renderItem={renderItem}
        data={this.props.sections}
        getItem={this.getSectionItem}
        getItemCount={() => itemCount}
        stickyHeaderIndices={stickyHeaderIndices}
        // TODO: onViewableItemsChanged
        inverted
      />
    );
  }
}
