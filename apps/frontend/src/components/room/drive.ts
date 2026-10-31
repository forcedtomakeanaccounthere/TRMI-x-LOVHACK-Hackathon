// Google Drive picker: signs in with Google (drive.readonly), lets the person pick files, and
// downloads them so they upload like any file from the device. Needs NEXT_PUBLIC_GOOGLE_CLIENT_ID and
// NEXT_PUBLIC_GOOGLE_API_KEY (an OAuth web client and an API key with the Picker API enabled).

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_API_KEY;
const SCOPE = "https://www.googleapis.com/auth/drive.readonly";

export const driveConfigured = Boolean(CLIENT_ID && API_KEY);

// Google Docs and Slides have no file of their own, so they're exported as DOCX and PPTX.
const EXPORTS: Record<string, { mime: string; ext: string }> = {
  "application/vnd.google-apps.document": {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: "docx",
  },
  "application/vnd.google-apps.presentation": {
    mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ext: "pptx",
  },
};

const PICKABLE = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ...Object.keys(EXPORTS),
].join(",");

/* eslint-disable @typescript-eslint/no-explicit-any -- the Google scripts ship no types */
type GoogleWindow = Window & { google?: any; gapi?: any };

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = Object.assign(document.createElement("script"), {
      src,
      async: true,
      onload: () => resolve(),
      onerror: () => reject(new Error(`Couldn't load ${src}`)),
    });
    document.head.append(s);
  });
}

let token: { value: string; expires: number } | null = null;

async function getToken(g: any): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  return new Promise((resolve, reject) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (res: { access_token?: string; expires_in?: number; error?: string }) => {
        if (!res.access_token) return reject(new Error(res.error ?? "Google sign-in was cancelled"));
        token = {
          value: res.access_token,
          expires: Date.now() + (res.expires_in ?? 3600) * 1000,
        };
        resolve(res.access_token);
      },
      error_callback: () => reject(new Error("Google sign-in was cancelled")),
    });
    client.requestAccessToken();
  });
}

export async function pickFromDrive(): Promise<File[]> {
  if (!driveConfigured)
    throw new Error("Google Drive isn't set up (NEXT_PUBLIC_GOOGLE_CLIENT_ID and NEXT_PUBLIC_GOOGLE_API_KEY)");
  await Promise.all([
    loadScript("https://accounts.google.com/gsi/client"),
    loadScript("https://apis.google.com/js/api.js"),
  ]);
  const w = window as GoogleWindow;
  await new Promise<void>((resolve) => w.gapi.load("picker", resolve));
  const access = await getToken(w.google);

  const picked = await new Promise<{ id: string; name: string; mimeType: string }[]>((resolve) => {
    const view = new w.google.picker.DocsView().setIncludeFolders(true).setMimeTypes(PICKABLE);
    const picker = new w.google.picker.PickerBuilder()
      .addView(view)
      .enableFeature(w.google.picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(access)
      .setDeveloperKey(API_KEY)
      .setCallback((data: any) => {
        if (data.action === w.google.picker.Action.PICKED) resolve(data.docs);
        else if (data.action === w.google.picker.Action.CANCEL) resolve([]);
      })
      .build();
    picker.setVisible(true);
  });

  return Promise.all(
    picked.map(async (doc) => {
      const exp = EXPORTS[doc.mimeType];
      const url = exp
        ? `https://www.googleapis.com/drive/v3/files/${doc.id}/export?mimeType=${encodeURIComponent(exp.mime)}`
        : `https://www.googleapis.com/drive/v3/files/${doc.id}?alt=media`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${access}` },
      });
      if (!res.ok) throw new Error(`Couldn't download ${doc.name} from Drive`);
      const blob = await res.blob();
      const name = exp && !doc.name.toLowerCase().endsWith(`.${exp.ext}`) ? `${doc.name}.${exp.ext}` : doc.name;
      return new File([blob], name, { type: exp?.mime ?? doc.mimeType });
    }),
  );
}
