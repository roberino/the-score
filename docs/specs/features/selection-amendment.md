I want to make note selection consistent between full bar selection, single note selection and multi-note selection. The visual indicator should be similar - a full bar should just have a selection that extends to the width of the bar (existing behaviour).

Multiple notes selected should look similar but the selection should just span the selected notes.

The context menu for full bar selection should be identitcal to single note selection but some operations will be invalid for certain selections. Invalid operations should just be disabled as per below:

**Context menu operation mapping:**

| Operation           | Single note                | Multi-note                   | Bar selection |
|---------------------|----------------------------|------------------------------|---------------|
| Tie                 | ✓                          | ✗ (disabled)                 | ✗ (disabled)  |
| Slur                | ✓                          | ✓ same-bar only, ✗ cross-bar | ✗ (disabled)  |
| Hairpin (cresc/dim) | ✗ (needs ≥2)               | ✓                            | ✗ (disabled)  |
| Tuplet              | ✓ (context-specific count) | ✓                            | ✗ (disabled)  |
| Articulations       | ✓                          | ✓                            | ✗ (disabled)  |
| Dynamics            | ✓ (per note)               | ✗ (disabled, ambiguous)      | ✗ (disabled)  |
| Volta               | ✓ (single measure)         | ✓ (span of selection)        | ✓             |
| Transpose           | ✓                          | ✓                            | ✓             |

Full bar and individual note selection should be mutually exclusive - when you select a single note while a full bar selection exists, the selection should narrow.

Context menus should not overlap each other. When one is displayed then another should not open. For example, the bar type menu should not open if the selection context menu is open.

Context menus should be closable - equivalent to cancelling the selection.

The select context menus should be movable (mouse-draggable) to enable for narrowing the selection.

Step to follow:

* Review this spec and ask clarifying questions
* Review existing specs and amend them to conform to new requirements
* Plan the implementation changes
* Review the plan and ensure all requirements met
* Implement changes