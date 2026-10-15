import type { Card } from "#lib/types.ts";
import type { DatabaseBackend } from "#lib/db/index.ts";

const EDIT_LOCK_RENEWAL_MS = 30_000;

export interface EditSession {
  cardId: string;
  /** A fresh owner is required for every editor mount, even for the same card. */
  owner: string;
  expectedUpdatedAt: string;
}

type CardLockBackend = Pick<
  DatabaseBackend,
  | "acquireCardLock"
  | "updateCardContentCasOwned"
  | "updateCardContentCasAndRelease"
  | "releaseCardLock"
  | "discardEmptyCard"
>;

interface CardEditSessionsOptions {
  getBackend: () => CardLockBackend;
  /** A lock operation returned a newer version of the card. */
  onCardChanged: (card: Card) => void;
  onRenewalError: (error: unknown) => void;
}

/**
 * Owns GUI card-edit sessions: lock acquisition, lease renewal, and owned
 * save/release. Persisted card state remains owned by DeckData, which is
 * told about every newer card version through `onCardChanged`. Failures
 * reject so the caller decides how to report them; only background lease
 * renewal reports through `onRenewalError`.
 */
export class CardEditSessions {
  private readonly sessions = new Map<string, EditSession>();
  private readonly leaseTimers = new Map<
    EditSession,
    ReturnType<typeof setInterval>
  >();
  /** A release waits for an already-started renewal before unlocking. */
  private readonly leaseRenewals = new Map<EditSession, Promise<void>>();
  private readonly releasing = new Set<EditSession>();

  constructor(private readonly options: CardEditSessionsOptions) {}

  /** Acquire the repository lock, or return the session already holding it. */
  async start(cardId: string): Promise<EditSession> {
    const existing = this.sessions.get(cardId);
    if (existing) return existing;
    const owner = `gui:${crypto.randomUUID()}`;
    const locked = await this.options.getBackend().acquireCardLock(cardId, owner);
    const session = { cardId, owner, expectedUpdatedAt: locked.updated_at };
    this.sessions.set(cardId, session);
    this.startLeaseRenewal(session);
    this.options.onCardChanged(locked);
    return session;
  }

  isActive(session: EditSession): boolean {
    return this.sessions.get(session.cardId) === session;
  }

  /** Commit content with the session's owner and version. `release` is
   * :wq/Ctrl+Enter; a failed save keeps the session so it can be retried. */
  async save(session: EditSession, content: string, release: boolean): Promise<Card> {
    try {
      const updated = release
        ? await this.saveAndRelease(session, content)
        : await this.options.getBackend().updateCardContentCasOwned(
            session.cardId,
            session.owner,
            content,
            session.expectedUpdatedAt,
          );
      this.options.onCardChanged(updated);
      session.expectedUpdatedAt = updated.updated_at;
      if (release) this.complete(session);
      return updated;
    } catch (e) {
      if (release) this.abortRelease(session);
      throw e;
    }
  }

  /** Release without saving. A no-op for a session that is no longer active;
   * a failed release keeps the session so the UI can retry with its owner. */
  async release(session: EditSession): Promise<void> {
    if (!this.isActive(session)) return;
    try {
      await this.prepareRelease(session);
      const released = await this.options
        .getBackend()
        .releaseCardLock(session.cardId, session.owner);
      this.options.onCardChanged(released);
      this.complete(session);
    } catch (e) {
      this.abortRelease(session);
      throw e;
    }
  }

  /** Physically delete the still-empty card while releasing its session. Like
   * `release`, a failure keeps the session so the UI can retry. */
  async discard(session: EditSession): Promise<void> {
    if (!this.isActive(session)) return;
    try {
      await this.prepareRelease(session);
      await this.options
        .getBackend()
        .discardEmptyCard(session.cardId, session.owner);
      this.complete(session);
    } catch (e) {
      this.abortRelease(session);
      throw e;
    }
  }

  private startLeaseRenewal(session: EditSession) {
    const timer = setInterval(() => {
      void this.renewLease(session);
    }, EDIT_LOCK_RENEWAL_MS);
    this.leaseTimers.set(session, timer);
  }

  private stopLeaseRenewal(session: EditSession) {
    const timer = this.leaseTimers.get(session);
    if (timer !== undefined) clearInterval(timer);
    this.leaseTimers.delete(session);
  }

  private async saveAndRelease(session: EditSession, content: string): Promise<Card> {
    await this.prepareRelease(session);
    return this.options.getBackend().updateCardContentCasAndRelease(
      session.cardId,
      session.owner,
      content,
      session.expectedUpdatedAt,
    );
  }

  /** Prevent an in-flight renewal from reacquiring a lock after its release. */
  private async prepareRelease(session: EditSession) {
    this.releasing.add(session);
    this.stopLeaseRenewal(session);
    await this.leaseRenewals.get(session);
  }

  private complete(session: EditSession) {
    this.stopLeaseRenewal(session);
    this.releasing.delete(session);
    this.sessions.delete(session.cardId);
  }

  private abortRelease(session: EditSession) {
    this.releasing.delete(session);
    if (this.isActive(session) && !this.leaseTimers.has(session)) {
      this.startLeaseRenewal(session);
    }
  }

  private renewLease(session: EditSession) {
    if (!this.isActive(session) || this.releasing.has(session)) {
      this.stopLeaseRenewal(session);
      return Promise.resolve();
    }
    const renewal = this.options
      .getBackend()
      .acquireCardLock(session.cardId, session.owner)
      .then((locked) => {
        if (this.isActive(session) && !this.releasing.has(session)) {
          this.options.onCardChanged(locked);
        }
      })
      .catch((e) => {
        if (!this.releasing.has(session)) this.options.onRenewalError(e);
      })
      .finally(() => {
        if (this.leaseRenewals.get(session) === renewal) {
          this.leaseRenewals.delete(session);
        }
      });
    this.leaseRenewals.set(session, renewal);
    return renewal;
  }
}
