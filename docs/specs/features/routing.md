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

**Instrument configuration**

The follow controls should be presented in a expandable context menu when an instrument is selected:

* Volume control
* Mute button
* Program name

## 4. Adding a channel

The channels panel contains an "Add channel" button so the user can introduce a new channel row before dragging a part to it.

**Behaviour**

* The button appears in the channels panel header, alongside the "Channels" label.
* Clicking the button opens a small inline picker (a `<select>` or equivalent) listing all MIDI channel numbers (1–16) that are not already displayed in the panel.
* Selecting a number from the picker immediately adds that channel as a new row in the channel list.
* The button is disabled when all 16 channels are already displayed (either because parts are using them or because they were manually added).
* A channel added this way that has no parts assigned to it is **ephemeral** — it exists only in local component state and is not persisted. Navigating away from the routing view discards any unassigned added channels.
* An empty (unassigned) channel row is visually distinguished from connected channels: the connector dot and label are rendered at reduced opacity to signal that nothing is routed to it yet.
* Parts can be dragged to an added empty channel exactly as they can to any existing channel.