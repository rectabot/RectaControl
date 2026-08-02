/** How long the app chases a board that has gone away, in one place.
 *
 *  Two pieces of code care about this and they must not disagree: App.tsx runs the
 *  chase, and a settings restore that has just sent `$REBOOT` stands waiting for it
 *  to succeed. On 2 Aug 2026 they did disagree — the restore gave up at a hard-coded
 *  25 s while a USB-only reconnect took 33 s. It then reported the one setting the
 *  whole restart existed for as *refused by the board*, on a board that had come
 *  back healthy eight seconds later and would have taken it.
 *
 *  The lesson is not "25 was too small". It is that a waiter with its own number
 *  cannot stay honest about somebody else's loop. So the loop's shape lives here and
 *  the deadline is derived from it.
 */

/** Attempts before the chase is called off. */
export const RECONNECT_TRIES = 14

/** Pause before each attempt — also the gap after the link drops, which keeps us
 *  from probing into the reset itself. */
export const RECONNECT_GAP_MS = 1500

/** What one failed attempt can cost. A refused TCP connect returns almost at once;
 *  one that goes unanswered sits on the OS timeout, which is where the seconds go on
 *  a rig whose Ethernet cable is out. Measured at ~4 s on Windows 10 on 2 Aug 2026;
 *  rounded up, because being early is the failure mode that hurts. */
export const RECONNECT_ATTEMPT_MS = 5000

/** The moment after which the app itself has stopped trying — so nobody waiting on
 *  the app has any reason to wait longer, and no reason to stop sooner. */
export const RECONNECT_GIVE_UP_MS = RECONNECT_TRIES * (RECONNECT_GAP_MS + RECONNECT_ATTEMPT_MS)
