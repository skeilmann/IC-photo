/* ============================================================
   Configuration — fill these three values in and the site works.
   Full step-by-step instructions: see README.md ("Setup").
   ============================================================ */

window.IC_CONFIG = {
  // 1) Google Cloud API key (restricted to the Drive API + your site's domain).
  //    Used only to READ the public shared folder for the gallery.
  API_KEY: "YOUR_API_KEY",

  // 2) OAuth 2.0 Client ID (type: Web application) from the same project.
  //    Used for "Sign in with Google" so friends can upload.
  CLIENT_ID: "YOUR_CLIENT_ID.apps.googleusercontent.com",

  // 3) The ID of the shared Google Drive folder that holds the photos.
  //    It's the last part of the folder URL:
  //    https://drive.google.com/drive/folders/<THIS_PART>
  FOLDER_ID: "YOUR_FOLDER_ID",

  // Optional: shown as the site/album name in a few places.
  EVENT_NAME: "Stockholm Convention 2026",
};
