# Team CRM — LinkedIn Chrome Extension

Prioritize LinkedIn message threads where **someone replied and is waiting for you**, then sync meetings and follow-ups to your Team CRM calendar.

## Install (developer mode)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `personal-crm/extension`

## Connect to Team CRM

1. Sign in to Team CRM at `http://localhost:3000`
2. Go to **LinkedIn** in the sidebar
3. Click **Copy connection for extension**
4. Open the extension popup → ⚙ → paste JSON → **Save connection**

## Use

1. Open [LinkedIn Messaging](https://www.linkedin.com/messaging/)
2. Click the extension icon → **Refresh inbox**
3. Expand a person to see **role, company, meeting notes**
4. Check conversations to sync → **Add selected to CRM calendar**

Team CRM will analyze each thread, rank importance, and add tasks to your **Tasks → Calendar**.

## Notes

- LinkedIn changes their page layout often — if Refresh finds nothing, reload the messaging page.
- Only threads where the **last message is not from you** are shown (people waiting for your reply).
- Requires the same Supabase migrations as call transcripts (`source_type`, task assignment columns).
- LinkedIn’s terms restrict automated scraping — use for your own inbox only.
