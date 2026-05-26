# Instrument Routing

## Overview

Instrument routing provides the user with a dedicated view for visualising instrument parts and their midi route (channel) and provides more convenient ways to edit the midi channels.

---

## 1. Navigation

The new view will be presented as a tab within the app so that the user can easily switch between score view and routing view.

## 2. Visualisation

* An new view should exist for routing, separate to the score view. 
* All parts should be displayed on the left hand side of this view. Known instruments should have a respective icon to visualise the instrument.
* A line should show the connection from each instrument to the configured channel of the selected midi device. Visually, this line should represent a lead, as though it is a real instrument connection to a device. 
* If no device is selected, the view should still be visible but an indicator with "no device configured" should be displayed.
* Only show channels in use
* If two or more parts use the same channel their lines should converge.
* The lead visual can be simple to start with

Source icons from wiki-commons - https://commons.wikimedia.org/wiki/Category:Musical_instrument_icons These should be placed into the assets folder to easily manage.

## 3. Configuration

The user should be able to configure channels from this view by moving a connection from an instrument to a different channel through a "drag" action. Changes will apply immediately. Standard undo/redo should apply (uses command history).

The midi device should also be configurable - this will be in addition to the simpler audio configuration in the menu (they should use the same implementation).

Other things will be configurable in a future iteration but out of scope for now. Consider this in the design.

**Out of scope configuration for instruments**

* Volume control
* Mute button
* Program name