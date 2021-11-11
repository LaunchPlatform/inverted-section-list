# inverted-section-list
A React Native component that implements SectionList with inverted direction and working sticky header

# Demo

```typescript
import React, { FunctionComponent } from "react";
import {
  SafeAreaView,
  StyleSheet,
  SectionList,
  Text,
  View,
} from "react-native";
import InvertedSectionList from "inverted-section-list";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginHorizontal: 16,
  },
  item: {
    backgroundColor: "#f9c2ff",
    padding: 20,
    marginVertical: 8,
  },
  header: {
    fontSize: 32,
    backgroundColor: "#fff",
  },
  title: {
    fontSize: 24,
  },
});

const DATA = [
  {
    title: "Main dishes",
    data: ["Pizza", "Burger", "Risotto", "a", "b", "c", "1", "2", "3"],
  },
  {
    title: "Sides",
    data: ["French Fries", "Onion Rings", "Fried Shrimps"],
  },
  {
    title: "Drinks",
    data: ["Water", "Coke", "Beer"],
  },
  {
    title: "Desserts",
    data: ["Cheese Cake", "Ice Cream"],
  },
];

const Item = ({ title }: { title: string }) => (
  <View style={styles.item}>
    <Text style={styles.title}>{title}</Text>
  </View>
);

const App: FunctionComponent = () => (
  <SafeAreaView style={styles.container}>
    <InvertedSectionList
      sections={DATA}
      keyExtractor={(item, index) => item + index}
      renderItem={({ item }) => <Item title={item} />}
      renderSectionFooter={({ section: { title } }) => (
        <Text style={styles.header}>{title}</Text>
      )}
      stickySectionHeadersEnabled
    />
  </SafeAreaView>
);

export default App;
```

To run the demo:

```bash
cd example
yarn install --dev
yarn start
```

# Install

Run

```bash
yarn add inverted-section-list
```

# Why?

The sticky header of inverted SectionList component of React Native is not working as expected.
There was issue open for years but no sign of the problem been fixed. At Launch Platform,
we are building a app product [Monoline](https://monoline.io), and its message list needs to present in inverted direction
with working sticky header:

<p align="center">
  <img src="assets/monoline-demo.gif?raw=true" alt="Monoline demo screencast" />
</p>

We have no choice but to find a way to fix this problem. Forking React Native is too much effort for us
to maintain. We have plan to open Pull Requests to upstream React Native repository, but we anticipate those
will take long time before they got reviewed and merged. To solve the problem before it's fixed in the upstream,
we build a standalone `InvertedSectionList` component.

# How?

There are different places where the logic needed to be changed in order for the inverted sticky header to work.
But those logic are deeply baked inside the build-in component's source code and there's no easy way to change them
from the outside. In order to make our InvertedSectionList component's sticky header to work, we copied the source
code from React Native 0.64 for following components:

- [ScrollView](https://github.com/facebook/react-native/blob/757bb75fbf837714725d7b2af62149e8e2a7ee51/Libraries/Components/ScrollView/ScrollView.js)
- [ScrollViewStickyFooter](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Components/ScrollView/ScrollViewStickyHeader.js)
- [VirtualizedSectionList](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizedSectionList.js)

Since we are using TypeScript here, so the original source code are converted into TypeScript.
There are following key changes were made from the original source code.

## ScrollView

For the `StickyHeaderComponent` component, we don't just pass in `nextHeaderLayoutY`, since now the order is inverted, we need to
also pass in `prevHeaderLayoutY` for the next sticky header to calculate the correct position of begin and end.
Such as, the sticky header layout update callback needs to set prev header value [here](https://github.com/LaunchPlatform/inverted-section-list/blob/db04f829993f0e1c6f6ba261fb459f8264080466/src/ScrollView.tsx#L446-L454):

```typescript
private _onStickyHeaderLayout(
  index: number,
  event: LayoutChangeEvent,
  key: string
) {
  /* ... */
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
```

And extra `prevLayoutY` props value needs to be calculated [here](https://github.com/LaunchPlatform/inverted-section-list/blob/db04f829993f0e1c6f6ba261fb459f8264080466/src/ScrollView.tsx#L572-L578):

```typescript
const prevKey = this._getKeyForIndex(prevIndex, childArray);
const prevLayoutY = this._headerLayoutYs.get(prevKey);
const prevLayoutHeight = this._headerLayoutHeights.get(prevKey);
let prevHeaderLayoutY: number | undefined = undefined;
if (prevLayoutY != null && prevLayoutHeight != null) {
  prevHeaderLayoutY = prevLayoutY + prevLayoutHeight;
}
```

Then passed into the `StickyHeaderComponent` [here](https://github.com/LaunchPlatform/inverted-section-list/blob/db04f829993f0e1c6f6ba261fb459f8264080466/src/ScrollView.tsx#L588)

## StickyFooterComponent

The `StickyHeaderComponent` source code is copied and renamed as `StickyFooterComponent`, because to make
sticky "header" works, we pass the header component as footer instead. New method `setPrevHeaderY` is
added [here](https://github.com/LaunchPlatform/inverted-section-list/blob/ceb0d30fbb50552f3037fb76d78fd46e37536da6/src/ScrollViewStickyFooter.tsx#L72-L75)
to receivew the previous header's position from `ScrollView`.

The another major change [here](https://github.com/LaunchPlatform/inverted-section-list/blob/ceb0d30fbb50552f3037fb76d78fd46e37536da6/src/ScrollViewStickyFooter.tsx#L210-L231)
is implementing the correct position calculation logic with the preview header y position provided from
our own `ScrollView`:

```typescript
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
```

## InvertedSectionList

We copied and combined the
[VirtualizedSectionList](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizedSectionList.js) and
[SectionList](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/SectionList.js)
components into `InvertedSectionList`.

The major change [here](https://github.com/LaunchPlatform/inverted-section-list/blob/69a44003500281d6b89166c59c407c5b9fa1050d/src/InvertedSectionList.tsx#L433-L438) is
that we are passing the footer indices as `stickyHeaderIndices` instead to the `VirtualizedList` since we are using
footer instead of header:

```typescript
// Notice: this is different from the original VirtualizedSectionList,
//         since we are actually using footer as the header here, so need to + 1
//         for the header
stickyHeaderIndices.push(
  itemCount + listHeaderOffset + sectionItemCount + 1
);
```
