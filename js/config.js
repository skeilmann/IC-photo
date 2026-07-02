/* ============================================================
   Configuration — fill these three values in and the site works.
   Full step-by-step instructions: see README.md ("Setup").
   ============================================================ */

window.IC_CONFIG = {
  // 1) Google Cloud API key (restricted to the Drive API + your site's domain).
  //    Used only to READ the public shared folder for the gallery.
  API_KEY: "AIzaSyA3Rlc2Whv8iGFxVAV2POvcZMkIlocTHVw",

  // 2) OAuth 2.0 Client ID (type: Web application) from the same project.
  //    Used for "Sign in with Google" so friends can upload.
  CLIENT_ID: "412077965645-splfu4dkld37280en1v5l5qr7er4f05v.apps.googleusercontent.com",

  // 3) The ID of the shared Google Drive folder that holds the photos.
  //    It's the last part of the folder URL:
  //    https://drive.google.com/drive/folders/<THIS_PART>
  FOLDER_ID: "14OS_wOhBpwwRQtuworJfFxf8V7lkoU0I",

  // Optional: shown as the site/album name in a few places.
  EVENT_NAME: "Stockholm Convention 2026",

  // The Google account that acts as admin: sees photos hidden by delete
  // requests and gets the review panel with Keep / Remove buttons.
  ADMIN_EMAIL: "gheorghe.cazacu.cimislia@gmail.com",
};
