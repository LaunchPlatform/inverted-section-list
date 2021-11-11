# inverted-section-list
A React Native component that implements SectionList with inverted direction and working sticky header

# Demo

Run

```bash
cd example
yarn install --dev
yarn start
```

## Why?

The sticky header of inverted SectionList component of React Native is not working as expected.
There was issue open for years but no sign of the problem been fixed. At Launch Platform,
we are building a app product Monoline, and its message list needs to present in inverted direction
with working sticky header:

TODO: insert image here

We have no choice but to find a way to fix this problem. Forking React Native is too much effort for us
to maintain. We have plan to open Pull Requests to upstream React Native repository, but we anticipate those
will take long time before they got reviewed and merged. To solve the problem before it's fixed in the upstream,
we build a standalone `InvertedSectionList` component.

## How?

There are different places where the logic needed to be changed in order for the inverted sticky header to work.
But those logic are deeply baked inside the build-in component's source code and there's no easy way to change them
from the outside. In order to make our InvertedSectionList component's sticky header to work, we copied the source
code from React Native 0.64 for following components:

- [ScrollView](https://github.com/facebook/react-native/blob/757bb75fbf837714725d7b2af62149e8e2a7ee51/Libraries/Components/ScrollView/ScrollView.js)
- [ScrollViewStickyFooter](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Components/ScrollView/ScrollViewStickyHeader.js)
- [VirtualizedSectionList](https://github.com/facebook/react-native/blob/6790cf137f73f2d7863911f9115317048c66a6ee/Libraries/Lists/VirtualizedSectionList.js)

Since we are using TypeScript here, so the original source code are converted into TypeScript.
There are following key changes were made from the original source code.

### ScrollView

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

### StickyHeaderComponent

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

