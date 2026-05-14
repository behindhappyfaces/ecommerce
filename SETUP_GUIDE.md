# Setup Guide — Heart of Texas Organics Integrations

This guide covers every step to get the scheduler and workshop calendar live.
No developer experience required. Follow each section in order.

---

## Table of Contents

1. [Calendly — Scheduler Setup](#1-calendly--scheduler-setup)
2. [Google Calendar — Workshop Calendar Setup](#2-google-calendar--workshop-calendar-setup)
3. [Eventbrite — Workshop Registration Links](#3-eventbrite--workshop-registration-links)
4. [Sync Calendly with Outlook](#4-sync-calendly-with-outlook)
5. [Sync Google Calendar with Outlook](#5-sync-google-calendar-with-outlook)
6. [Add Passwords and Keys to the Website](#6-add-passwords-and-keys-to-the-website)
7. [Quick Checklist](#7-quick-checklist)
8. [Troubleshooting](#8-troubleshooting)

---

## 1. Calendly — Scheduler Setup

**What it does:** Lets customers book a 1-on-1 consultation with you after entering an access code.

### Step 1 — Create your Calendly account
1. Go to **calendly.com** and sign up with your email.
2. Choose the free plan (it supports 1 event type, which is all you need).

### Step 2 — Set up your event type
1. Click **"+ New Event Type"**
2. Choose **"One-on-One"**
3. Fill in:
   - **Event name:** Consultation (or whatever you'd like to call it)
   - **Duration:** 30, 45, or 60 minutes — your choice
   - **Location:** Phone call, Zoom, or in person
4. Click **"Next"** and set your available hours.
5. Click **"Save and Close"**.

### Step 3 — Get your Calendly embed URL
1. From your Calendly dashboard, click on the event type you just created.
2. Click **"Share"** → **"Add to Website"** → **"Inline Embed"**.
3. You will see a URL that looks like:
   ```
   https://calendly.com/your-username/consultation
   ```
4. Copy that URL. You will paste it into the website file in Section 6.

### Step 4 — Connect your calendar
1. In Calendly, go to **Account Settings → Calendar Connection**.
2. Click **"Connect a Calendar"** and choose **Microsoft (Outlook/Office 365)**.
3. Sign in with your `operations@heartoftexasorganics.com` account.
4. Calendly will now automatically block times on Calendly when Outlook already has something scheduled, and add new Calendly bookings to Outlook automatically.

---

## 2. Google Calendar — Workshop Calendar Setup

**What it does:** Shows your upcoming workshops on the Workshops page. You add events to Google Calendar and they appear on your website automatically.

### Step 1 — Create a Google Calendar for workshops
1. Go to **calendar.google.com** and sign in with your Google account.
2. On the left sidebar, click the **"+"** next to "Other calendars".
3. Choose **"Create new calendar"**.
4. Name it: **Heart of Texas Organics Workshops**
5. Click **"Create calendar"**.

### Step 2 — Make the calendar public
This is required so your website can read events without a login.
1. Click the three dots next to your new calendar → **"Settings and sharing"**.
2. Scroll to **"Access permissions for events"**.
3. Check **"Make available to public"**.
4. Click **"OK"** on the confirmation.

### Step 3 — Get your Calendar ID
1. Stay on the same Settings page.
2. Scroll down to **"Integrate calendar"**.
3. Copy the **Calendar ID** — it looks like:
   ```
   abc123xyz@group.calendar.google.com
   ```
   or for your main Google calendar it may just be your email address.
4. Save this — you will paste it into the website file in Section 6.

### Step 4 — Get a Google API Key
1. Go to **console.cloud.google.com** and sign in.
2. Click **"Select a project"** at the top → **"New Project"**.
3. Name it: **Heart of Texas Website** → Click **"Create"**.
4. In the search bar at the top, search for **"Google Calendar API"**.
5. Click on it and click **"Enable"**.
6. In the left menu, go to **"APIs & Services" → "Credentials"**.
7. Click **"+ Create Credentials" → "API Key"**.
8. Copy the API key shown.
9. Click **"Edit API Key"** (pencil icon) and under "API restrictions":
   - Select **"Restrict key"**
   - Choose **"Google Calendar API"**
   - Click **"Save"**
10. Save this key — you will paste it into the website file in Section 6.

### Step 5 — Add workshop events to Google Calendar
When you create a workshop:
1. Open your **Heart of Texas Organics Workshops** calendar.
2. Click the date to create a new event.
3. Fill in:
   - **Title:** The workshop name (e.g., "Artisan Bread Making Class")
   - **Date and time:** Start and end time
   - **Description:** Write a description of the workshop. On a new line, paste the full Eventbrite registration link (see Section 3). The website reads the first URL it finds in the description and uses it as the Register Now button.
4. Click **"Save"**.

The event will appear on your website automatically within a few minutes.

---

## 3. Eventbrite — Workshop Registration Links

**What it does:** Handles ticket sales and attendee registration for each workshop.

### Step 1 — Create your Eventbrite account
1. Go to **eventbrite.com** and click **"Sign Up"**.
2. Use your `operations@heartoftexasorganics.com` email.

### Step 2 — Create an event
1. Click **"Create Event"** in the top right.
2. Fill in all the details: event name, date, location, description, and ticket price (or free).
3. Click **"Publish"**.

### Step 3 — Get the event URL
1. After publishing, go to your event page.
2. Copy the full URL from the browser bar. It looks like:
   ```
   https://www.eventbrite.com/e/artisan-bread-making-class-tickets-12345678
   ```
3. Paste this URL into the **Description** field of the matching Google Calendar event (Step 5 of Section 2). The website will find it automatically and turn it into the "Register Now" button.

---

## 4. Sync Calendly with Outlook

**Already covered in Section 1, Step 4.** Calendly connects directly to Outlook, so:
- When someone books a Calendly consultation, it appears in your Outlook calendar automatically.
- When you are busy in Outlook, Calendly blocks that time so customers cannot book it.

---

## 5. Sync Google Calendar with Outlook

This lets you manage workshop events from either Google Calendar or Outlook — they stay in sync.

### Option A — View Google Calendar events inside Outlook (recommended)
1. In Google Calendar, go to the settings for your **Heart of Texas Organics Workshops** calendar.
2. Scroll to **"Integrate calendar"** and copy the **Secret address in iCal format** link.
3. Open **Outlook** → **Calendar** → **Add Calendar** → **Subscribe from web**.
4. Paste the iCal link and click **"Import"**.
5. Your Google Calendar workshop events will now appear in Outlook (read-only, syncs every few hours).

### Option B — Two-way sync using a free tool
If you want changes made in Outlook to also appear in Google Calendar, use **Sync2** (sync2.com) or **CalendarBridge** (calendarbridge.com). Both have free tiers.

---

## 6. Add Passwords and Keys to the Website

### Scheduler page (scheduler.html)
Open the file `/Users/deborahsmith/farm-website/scheduler.html` in a text editor.

Find this section near the bottom of the file (search for CONFIGURATION):

```javascript
const SCHEDULER_PASSWORD = 'YOUR_PASSWORD_HERE';
const CALENDLY_URL       = 'https://calendly.com/YOUR_USERNAME/consultation';
```

Replace:
- `YOUR_PASSWORD_HERE` with the access code you want customers to use (save this in Bitwarden)
- `YOUR_USERNAME/consultation` with your actual Calendly URL from Section 1, Step 3

### Workshop calendar page (workshops.html)
Open the file `/Users/deborahsmith/farm-website/workshops.html` in a text editor.

Find this section (search for CONFIGURATION):

```javascript
const CALENDAR_ID = 'YOUR_CALENDAR_ID@group.calendar.google.com';
const API_KEY     = 'YOUR_GOOGLE_API_KEY';
```

Replace:
- `YOUR_CALENDAR_ID@group.calendar.google.com` with your Calendar ID from Section 2, Step 3
- `YOUR_GOOGLE_API_KEY` with your API key from Section 2, Step 4

### Save to Bitwarden
Add a Secure Note in Bitwarden called **Website Integration Keys** and record:
- Scheduler access code (password)
- Calendly URL
- Google Calendar ID
- Google API Key
- Eventbrite account login

### Push to GitHub (to go live)
After editing the files, run the following in your terminal from the farm-website folder:
```bash
git add scheduler.html workshops.html
git commit -m "Add API keys for scheduler and workshop calendar"
git push origin main
```
Render will deploy automatically within 2 minutes.

---

## 7. Quick Checklist

### Scheduler
- [ ] Calendly account created
- [ ] Event type set up with availability
- [ ] Calendly connected to Outlook calendar
- [ ] `SCHEDULER_PASSWORD` replaced in scheduler.html
- [ ] `CALENDLY_URL` replaced in scheduler.html
- [ ] Deployed to GitHub / Render

### Workshop Calendar
- [ ] Google Calendar created and made public
- [ ] Calendar ID copied
- [ ] Google Cloud project created with Calendar API enabled
- [ ] API key created and restricted to Calendar API
- [ ] `CALENDAR_ID` replaced in workshops.html
- [ ] `API_KEY` replaced in workshops.html
- [ ] Test event added to Google Calendar with Eventbrite URL in description
- [ ] Deployed to GitHub / Render

### Eventbrite
- [ ] Eventbrite account created
- [ ] At least one event published
- [ ] Eventbrite URL pasted into Google Calendar event description

---

## 8. Troubleshooting

**Scheduler shows "Incorrect access code" even with the right password**
- Make sure there are no extra spaces before or after the password in scheduler.html.
- Passwords are case-sensitive. Capital letters matter.

**Calendly embed shows a blank white box**
- Double-check the Calendly URL in scheduler.html. It must start with `https://calendly.com/`.
- Make sure the Calendly event type is still published and not deleted.

**Workshop calendar shows "Could not load workshops"**
- Calendar configuration error: your Calendar ID or API key is wrong. Re-copy them from Google.
- Calendar not public: go back to Section 2, Step 2 and make sure "Make available to public" is checked.
- API not enabled: go to Google Cloud Console and confirm the Google Calendar API is enabled.

**Workshop events appear but "Register Now" goes to Contact page instead of Eventbrite**
- The Eventbrite URL needs to be in the Google Calendar event description.
- Make sure the full URL starts with `https://` — partial URLs will not be detected.

**Google Calendar events take too long to show up on the website**
- Google Calendar API updates are usually immediate. If you just added an event and it does not appear, wait 2 minutes and hard-refresh the page (Ctrl+Shift+R on Windows, Cmd+Shift+R on Mac).

**Session expires before 8 hours**
- This is normal if the browser data is cleared. Customers will need to re-enter the access code.
- The 8-hour timer resets on each login.
