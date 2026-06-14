-- Social notifications: pro gets notified when a client follows them.
ALTER TYPE "NotificationEventKey" ADD VALUE IF NOT EXISTS 'LOOK_FOLLOWER_NEW';
