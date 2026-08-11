import { exec } from 'child_process';
import { promisify } from 'util';
import { logger } from '../logger';

const execAsync = promisify(exec);

export class AdbBridge {
  private readonly targetUrl: string;

  constructor(ip: string, port: number | string) {
    this.targetUrl = `${ip}:${port}`;
  }

  private async runCommand(command: string): Promise<string> {
    try {
      const { stdout, stderr } = await execAsync(command);
      if (stderr && stderr.trim().length > 0) {
        logger.debug({ event: 'adb_stderr', command, stderr });
      }
      return stdout.trim();
    } catch (error: any) {
      // execAsync throws on non-zero exit codes.
      logger.error({ event: 'adb_command_failed', command, error: error.message });
      throw new Error(`ADB Command Failed: ${error.message}`);
    }
  }

  /**
   * Waits for the device to become available and connects to it.
   */
  async connect(maxRetries = 10, retryDelayMs = 2000): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info({ event: 'adb_connect_attempt', target: this.targetUrl, attempt });

        // Connect to the TCP/IP device
        const result = await this.runCommand(`adb connect ${this.targetUrl}`);

        // 'adb connect' often returns 0 even if it fails, so we parse the output
        if (result.includes('connected to') && !result.includes('failed to connect')) {

           // Ensure it's not "offline" or "unauthorized" by checking device state
           const state = await this.runCommand(`adb -s ${this.targetUrl} get-state`);
           if (state === 'device') {
              logger.info({ event: 'adb_connect_success', target: this.targetUrl });
              return true;
           }
        }
      } catch (error) {
        logger.debug({ event: 'adb_connect_error', attempt, error: String(error) });
      }

      // Wait before retrying
      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }

    logger.error({ event: 'adb_connect_timeout', target: this.targetUrl });
    return false;
  }

  /**
   * Installs an APK onto the target emulator.
   */
  async installApp(apkPath: string): Promise<void> {
    logger.info({ event: 'adb_install_app', apkPath, target: this.targetUrl });
    await this.runCommand(`adb -s ${this.targetUrl} install -r ${apkPath}`);
  }

  /**
   * Launches the main activity of a package using Monkey.
   */
  async launchApp(packageName: string): Promise<void> {
    logger.info({ event: 'adb_launch_app', packageName, target: this.targetUrl });
    await this.runCommand(`adb -s ${this.targetUrl} shell monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`);
  }

  /**
   * Executes a raw shell command on the target device.
   */
  async executeShellCommand(command: string): Promise<string> {
    logger.debug({ event: 'adb_shell_command', command, target: this.targetUrl });
    return this.runCommand(`adb -s ${this.targetUrl} shell ${command}`);
  }

  /**
   * Disconnects the device.
   */
  async disconnect(): Promise<void> {
    try {
      logger.info({ event: 'adb_disconnect', target: this.targetUrl });
      await this.runCommand(`adb disconnect ${this.targetUrl}`);
    } catch (e) {
      // Ignore disconnect errors to prevent teardown failure
      logger.warn({ event: 'adb_disconnect_failed', error: String(e) });
    }
  }
}
