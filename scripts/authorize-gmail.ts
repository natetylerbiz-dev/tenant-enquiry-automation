import http from "node:http";
import dotenv from "dotenv";
import { google } from "googleapis";

dotenv.config({ quiet: true });

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}/oauth2callback`;

async function main() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    console.error(
      "GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET must be set in .env before running this script.\n" +
        "Create an OAuth Client ID (Desktop app) in Google Cloud Console, enable the Gmail API, and add its\n" +
        `redirect URI as ${REDIRECT_URI}.`
    );
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ["https://www.googleapis.com/auth/gmail.modify"],
  });

  console.log("Open this URL in your browser and approve access:\n");
  console.log(authUrl);
  console.log(`\nWaiting for the redirect on ${REDIRECT_URI} ...`);

  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "", REDIRECT_URI);
      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");

      if (error) {
        res.end(`Authorization failed: ${error}. You can close this tab.`);
        server.close();
        reject(new Error(`OAuth authorization failed: ${error}`));
        return;
      }

      if (code) {
        res.end("Authorization received. You can close this tab and return to the terminal.");
        server.close();
        resolve(code);
      }
    });

    server.listen(PORT);
  });

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      "\nNo refresh token was returned. This usually means you've already authorized this app before.\n" +
        "Revoke access at https://myaccount.google.com/permissions and re-run this script."
    );
    process.exit(1);
  }

  console.log("\nSuccess. Add this to your .env file:\n");
  console.log(`GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch((err) => {
  console.error("authorize-gmail failed:", err);
  process.exit(1);
});
