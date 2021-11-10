# inverted-section-list
A React Native component that implements SectionList with inverted direction and working sticky header

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
