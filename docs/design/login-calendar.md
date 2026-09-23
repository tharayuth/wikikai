# Login calendar preview

Asset: `client/public/assets/login-calendar.webp`.

Edited from a user-supplied screenshot with the built-in imagegen tool, then
encoded as WebP. Private project names, summary details, document titles and
document IDs are obscured in the image pixels. The original screenshot is
excluded locally from Git and is not served by the application. The frame,
shadow and tilt are CSS, so they adapt to the page layout and theme.

The developer-page link uses the Facebook URL supplied by the user.

## Editing prompt

```text
Use case: precise-object-edit
Asset type: privacy-redacted product screenshot for a public WikiKai login page.
Input image: the supplied calendar screenshot is the edit target.
Primary request: edit this screenshot to permanently obscure all private content while keeping the actual calendar interface recognizable and crisp.
Redact: erase ALL original characters in the project name at top left, the summary counts immediately below it, and EVERY event row's full document title and document ID throughout the calendar, including faint entries in adjacent-month cells. Replace each erased text region with a soft, strongly blurred neutral gray horizontal placeholder band so absolutely no original word, abbreviation, ID or character can be read at full resolution. The blur must be baked into the output pixels, not an overlay hiding underlying text. Do not leave partly readable project or document titles anywhere. Keep the small colored activity lines and trailing event counts.
Preserve: the original wide rectangular screenshot composition, all seven calendar columns, all five week rows, day-of-month numbers, weekdays, the September 2026 month label, selected-day circle, Created / Edited filters, Show pages, Today and navigation arrows. Keep all public interface labels sharp and unchanged. Keep the light theme, exact calendar grid geometry and spacing. Preserve the original aspect ratio (1562 by 904).
Constraints: flat screenshot only, no frame, no shadow, no tilt, no added illustration, no new private text, no watermark. Frame, shadow and rotation will be added by the website. Return the edited image and its local file path.
```
