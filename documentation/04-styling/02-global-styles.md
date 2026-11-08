---
title: Global styles
description: Host-managed styling for the whole document
---

Global styles are applied site-wide. Chocola core does not discover, bundle, or write global CSS; that is the host's job.

### Interaction with Scoped Styles

Scoped styles can override global styles for the elements inside a component, but components can also reference global CSS normally.

Because Chocola returns scoped CSS only, global CSS ordering and cascade behavior remain under the host's control.
