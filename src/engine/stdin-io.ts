import { createInterface, type Interface } from 'node:readline';
import chalk from 'chalk';

export class StdinIO {
  private rl: Interface;
  private closed = false;

  constructor() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    this.rl.on('close', () => {
      this.closed = true;
    });
  }

  /**
   * Prompt the user for input. Supports multi-line input:
   * - Pasted text (lines < 150ms apart) is buffered; submits 150ms after last line
   * - Typed input: submits 400ms after last Enter
   * - Blank lines are treated as content — never trigger early submit.
   *   This is intentional: timing-based blank-line detection is unreliable across
   *   terminals and system load, and has caused repeated paste truncation bugs.
   */
  async prompt(message?: string): Promise<string> {
    if (this.closed) {
      throw new Error('Input stream closed');
    }

    if (message) {
      console.log(message);
    }
    console.log();

    process.stdout.write(chalk.cyan('You: '));

    return new Promise<string>((resolve, reject) => {
      const lines: string[] = [];
      let timer: ReturnType<typeof setTimeout> | null = null;
      const PASTE_WAIT_MS = 1000;
      const TYPED_WAIT_MS = 1000;
      let lastLineTime = 0;

      const cleanup = () => {
        if (timer) clearTimeout(timer);
        this.rl.removeListener('line', onLine);
        this.rl.removeListener('close', onClose);
      };

      const submit = () => {
        cleanup();
        resolve(lines.join('\n'));
      };

      const onLine = (line: string) => {
        const now = Date.now();
        const gap = now - lastLineTime;
        lastLineTime = now;

        lines.push(line);
        if (timer) clearTimeout(timer);

        // Paste: lines arrive < 150ms apart — wait 150ms after the last one.
        // Typed: lines arrive > 150ms apart — wait 400ms after the last one.
        // Either way, the timer — not blank lines — decides when to submit.
        const waitMs = gap < PASTE_WAIT_MS ? PASTE_WAIT_MS : TYPED_WAIT_MS;
        timer = setTimeout(submit, waitMs);
      };

      const onClose = () => {
        cleanup();
        if (lines.length > 0) {
          resolve(lines.join('\n'));
        } else {
          reject(new Error('Input stream closed'));
        }
      };

      this.rl.on('line', onLine);
      this.rl.on('close', onClose);
    });
  }

  printAssistant(text: string): void {
    console.log();
    console.log(chalk.dim('─'.repeat(60)));
    console.log(text);
    console.log(chalk.dim('─'.repeat(60)));
  }

  close(): void {
    if (!this.closed) {
      this.rl.close();
      this.closed = true;
    }
  }
}
