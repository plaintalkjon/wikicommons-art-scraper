import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Send a desktop notification when the upload completes
 */
export async function notifyCompletion(artist: string, result: {
  attempted: number;
  uploaded: number;
  skipped: number;
  errors: number;
}): Promise<void> {
  const message = `${artist}: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors} errors`;
  
  // Try desktop notification (works on Linux with notify-send, Mac with osascript, Windows with toast)
  try {
    // Linux - notify-send
    await execAsync(`notify-send "Art Upload Complete" "${message}" --icon=dialog-information`);
  } catch {
    try {
      // macOS - osascript
      await execAsync(`osascript -e 'display notification "${message}" with title "Art Upload Complete"'`);
    } catch {
      try {
        // Windows - PowerShell toast notification
        await execAsync(`powershell -Command "New-BurntToastNotification -Text 'Art Upload Complete', '${message}'"`);
      } catch {
        // Fallback: just use terminal bell
        process.stdout.write('\x07'); // Terminal bell
      }
    }
  }
  
  // Always ring terminal bell as backup
  process.stdout.write('\x07');
  
  // Also write to a completion file
  const fs = require('fs');
  const completionFile = '/tmp/wikicommons-upload-complete.txt';
  fs.writeFileSync(completionFile, JSON.stringify({
    artist,
    timestamp: new Date().toISOString(),
    result,
  }, null, 2));
}

