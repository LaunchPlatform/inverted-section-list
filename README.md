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

https://github.com/LaunchPlatform/inverted-section-list/blob/db04f829993f0e1c6f6ba261fb459f8264080466/src/ScrollView.tsx#L572-L574

