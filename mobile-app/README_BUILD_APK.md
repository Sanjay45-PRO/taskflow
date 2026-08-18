# How to build the TaskFlow APK

## 1. Install prerequisites (one-time, on your computer)
```
npm install -g eas-cli
```
Create a free Expo account at https://expo.dev if you don't have one.

## 2. Install project dependencies
Open this folder in a terminal:
```
npm install
```

## 3. Log in to Expo
```
eas login
```

## 4. Configure the build (one-time)
```
eas build:configure
```
This creates an eas.json file — accept the defaults.

## 5. Build the APK
```
eas build -p android --profile preview
```
- This runs on Expo's servers (no Android Studio needed on your computer).
- Takes about 10-20 minutes.
- When done, it gives you a download link for the .apk file.

## 6. Distribute
Download the .apk and share it directly with your 5 employees (WhatsApp, email, Google Drive link — any method). 
They'll need to:
1. Allow "Install from unknown sources" on their phone (Android will prompt them the first time)
2. Install the APK
3. Open TaskFlow, log in with their name + workspace code (same login as the web dashboard)
4. Allow location permission (including "Allow all the time" when prompted, for background tracking)

## Notes
- This app shares the SAME Supabase database as your web dashboard — no separate setup needed.
- Every time you want to update the app, repeat step 5 and redistribute the new APK.
