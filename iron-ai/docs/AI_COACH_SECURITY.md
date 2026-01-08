# AI Coach Security

## Client-side API Key Risks
- The OpenAI API key is stored locally on the device.
- Anyone with access to the device or browser storage can read it.
- Use a low-privilege key when possible and rotate keys periodically.
- The key is never logged by the app.

## Best Practices
- Keep the key private and do not share screenshots.
- Prefer using a dedicated key for this app.
- Disable Coach Memory if you do not want preferences stored locally.

## Data Sharing Controls
- Context sharing is OFF by default.
- Users choose which scopes to share and can preview the data before sending.
- The snapshot is size-limited and marked as truncated when applicable.

## Medical Disclaimer Behavior
The coach avoids medical advice and will recommend a qualified professional for
injuries or health-related topics.
