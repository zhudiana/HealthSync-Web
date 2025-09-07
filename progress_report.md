# HealthSync Progress Report

**Date:** September 4, 2025
**Prepared by:** Yodit F. Ayele

---

## Completed Work

- **Web Application Connection:**

  - The HealthSync web app is now connected with both **Fitbit** and **Withings** APIs.
  - Users can successfully log in and give permission (authorization) through both platforms.

- **Health Metrics Display (Partial):**

  - Some health data from **Withings** is already visible on the backend system (via the testing interface).
  - The dashboard shows some data, but not all. Fitbit data is not yet visible on the dashboard.

---

## Work in Progress

- **Data Display on Dashboard:**

  - At the moment, **Withings data** is confirmed to be retrieved correctly at the backend, but not fully displayed on the dashboard.
  - **Fitbit data** is not yet showing on the dashboard, though the connection is successful.
  - I am currently working on fixing this so that **all health metrics appear clearly on the user dashboard**.

- **Mobile App Testing:**

  - For **Android**, I can only test using an emulator (simulator) since I don’t have a physical device.
  - For **iOS (iPhone/iPad)**, Apple requires a **paid developer subscription** to allow apps to redirect back to HealthSync after Fitbit/Withings authorization.
  - Because of this limitation, the iOS version cannot yet be tested on a real device.

---

## Next Steps

1. **Complete Dashboard Integration**

   - Ensure all health metrics (Fitbit and Withings) are displayed properly on the web dashboard.

2. **Android Mobile App**

   - Once the dashboard works correctly, move forward with making the Android version usable.

3. **User Database & Notifications**

   - Save user information (such as email) into the database server.
   - Implement an **alert system**:

     - If a user’s health metrics go above or below a safe threshold, HealthSync will automatically send them an **email or notification**.

---

## Notes

- I prioritized the **web version** because it is more practical to test and debug, and it allows me to confirm that the health metrics are being collected correctly.
- The **mobile version** will follow after the dashboard issue is solved.
