---
published: false
type: newsletter
source-notes: lid-health-monitor-newsletter-notes.md
---

# Unknown Is Not Down: The Infrastructure Lesson That Cost Three Days of Community Data

---

> "O you who have believed, if there comes to you a disobedient one with information, investigate, lest you harm a people out of ignorance and become, over what you have done, regretful."
> — Quran 49:6 (Surah Al-Hujurat)

---

The alert came at 2:40am.

🔴 Bot DOWN — status: unknown. Auto-restarting gateway.

I woke up to it. Checked the bot. It was fine. It had been fine all night. A 400-person community group had gone quiet after midnight — normal, expected — and the health check had read that silence as death. The system couldn't distinguish between a bot that was broken and a bot that was simply waiting.

So it did something destructive to fix a problem that didn't exist.

By the time the community woke up and messages started flowing again, three days of queued messages were gone. Silently dropped, one by one, 50+ times in the logs. Unrecoverable.

That's the thing about some infrastructure failures. They don't announce themselves. They clean up after themselves. You find out hours later, or you never find out at all.

> [SUBSCRIBE CTA: Insert button here]

---

## The failure had two independent layers

**Layer 1: Logs are activity records, not health signals.**

The monitor asked: "Is there evidence in the logs that the bot is alive?" That's the wrong question. Absence of evidence is not evidence of absence. A group chat at midnight produces no log lines. The bot was connected, authenticated, waiting — but it had nothing to log. The monitor read emptiness as failure.

The corrected monitor asks: "What does the system report its own status as?" A direct query — linked, unlinked, connecting, error — not an inference from silence. The difference sounds small. The consequences were not.

A health check that can't distinguish "silent and healthy" from "silent and broken" will eventually do something destructive at 3am. The fix is to ask a question that gets a real answer, not to read absence like a signal.

**Layer 2: The privacy architecture that makes restarts expensive.**

This one is harder, because it's not a bug — it's a feature of how WhatsApp works.

When a member joins a large group, their messages arrive with an opaque identifier — a LID — not their phone number. This is deliberate. WhatsApp migrated to this system specifically to prevent bulk harvesting of phone numbers from large groups. You cannot request the full mapping for a group of hundreds of people. Privacy by design.

The implication for bot builders: your application learns who is who incrementally, as members speak. A member who joined six months ago but hasn't sent a message in three weeks is, from the bot's perspective, an anonymous identifier — until they speak again.

A gateway restart resets that learned state. Every member the bot knew is temporarily a stranger. Messages from those members, during the window before they've re-identified themselves, are either dropped or handled generically — without personalisation, without memory context, without the history that makes the agent useful.

This isn't obvious until you've hit it. And the cost of hitting it at 3am is data you can't get back.

---

## The Quranic principle this violated

The verse from Al-Hujurat was revealed about a man who brought a report that nearly launched a military expedition against people who had done nothing wrong. The Prophet ﷺ was about to act on unverified information. The verse stopped him: *fatabayyanoo* — investigate first.

The scholars note that the verse ties acting without verification to two specific consequences: harming people out of ignorance, and regret that follows. Both materialised here. The community lost three days of conversations. We had no way to get them back.

*Tabayyun* — verification before action — isn't a principle reserved for interpersonal disputes. It applies to every system we build that acts on behalf of people. The monitor received a signal: unknown. It did not investigate what that signal meant. It acted on the worst-case interpretation of something ambiguous.

There's a related principle in Islamic jurisprudence: *la darar wa la dirar* — neither initiating harm nor reciprocating it. Acting on a *zann* (an assumption, an unverified reading) that causes harm to something functioning correctly is exactly this. The bot was healthy. The restart was the harm. The ambiguous signal was the *zann* that should have been verified before anything was touched.

Building AI infrastructure for communities carries a responsibility that pure engineering framing doesn't fully capture. These aren't dashboards. They're serving real people who trusted us with their conversations, their questions, their history. The standard for action should be verification, not assumption.

---

## What to do differently

If you're building AI agents for WhatsApp groups — or any stateful messaging infrastructure — these are the things worth knowing before you hit them in production.

**Separate health from activity.** Your health check should query the connection's actual status directly. Silence is not a health signal. A group going quiet overnight is expected behaviour, not a failure mode.

**Define `unknown` as "do nothing."** A monitor that can't confirm a bad status — disconnected, logged out, authentication error — should not trigger a restart. Unknown means you don't know. Acting destructively on not-knowing is how you create the problem you were trying to prevent.

**Know what a restart costs in your specific context.** If your system has accumulated learned state over weeks of operation — user preferences, conversation history, identifier mappings — a restart is not free. Know what you're discarding before automating the action.

**Spec the persistence layer before you build it.** The right response to an incident like this isn't a quick patch — it's a specification that defines what "fixed" actually means before you write a line of code. What does a clean restart look like? What must be restored from persistent storage before the first message is processed? What acceptance criteria prove the problem is solved, not just hidden?

```bash
mm spec new --from-examples
```

This produces a structured spec with acceptance criteria, constraints, and verification targets. Build against it. Then verify:

```bash
mm harness verify
```

The incident tells you there's a problem. The spec tells you what solved looks like. Skipping that step is how patches become new failure modes three months later.

**Verify the fix, don't just deploy it.** Restarting a bot in a test environment is not the same as confirming the persistence layer works correctly under a real restart sequence. Write the acceptance criteria explicitly. Then confirm they're met before calling it done.

> [SUBSCRIBE CTA: Insert button here]

---

There's a category of infrastructure failure that only reveals itself at 3am, in silence, after the damage is done. Understanding the failure modes before you build against them is what separates a system that is merely running from one that is trustworthy.

If you're building AI agents for communities — WhatsApp, Telegram, or elsewhere — and want to talk through the architecture before you hit this in production, reply to this. I'd rather you learn from our 3am than your own.

> [SUBSCRIBE CTA: Insert button here]

[github.com/multimodeai/mm-cli](https://github.com/multimodeai/mm-cli)
