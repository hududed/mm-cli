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
   * - Pasted text (lines < 50ms apart) is buffered automatically
   * - Typed multi-line: first Enter starts multi-line mode, second blank Enter submits
   * - Single-line: if the line has content and no follow-up within 150ms, submits immediately
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
      const PASTE_WAIT_MS = 150;
      const TYPED_WAIT_MS = 400;
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

        // Blank line after content = submit (double-Enter)
        if (line.trim() === '' && lines.length > 0 && lines.some(l => l.trim() !== '')) {
          // If this looks like a paste (rapid blank line), keep buffering
          if (gap < PASTE_WAIT_MS) {
            lines.push(line);
            if (timer) clearTimeout(timer);
            timer = setTimeout(submit, PASTE_WAIT_MS);
            return;
          }
          // Typed blank line after content = submit
          submit();
          return;
        }

        lines.push(line);
        if (timer) clearTimeout(timer);

        // Use shorter wait for paste detection, longer for typed input
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
