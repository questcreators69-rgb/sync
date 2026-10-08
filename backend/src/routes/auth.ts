import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import {
  findOneItem,
  insertItem,
  migrateOwnerData,
} from '../db/mongo.js';

export const authRouter = Router();

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function verifyPassword(password: string, salt: string, storedHash: string): boolean {
  const hash = hashPassword(password, salt);
  const hashBuffer = Buffer.from(hash, 'hex');
  const storedBuffer = Buffer.from(storedHash, 'hex');
  if (hashBuffer.length !== storedBuffer.length) return false;
  return crypto.timingSafeEqual(hashBuffer, storedBuffer);
}

authRouter.post('/register', async (req: Request, res: Response) => {
  const { email, password, name, previousOwnerId } = req.body || {};

  if (!email || typeof email !== 'string' || !email.includes('@')) {
    res.status(400).json({ error: 'A valid email address is required.' });
    return;
  }

  if (!password || typeof password !== 'string' || password.length < 6) {
    res.status(400).json({ error: 'Password must be at least 6 characters long.' });
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await findOneItem('users', { email: normalizedEmail });
  if (existing) {
    res.status(409).json({ error: 'An account with this email address already exists. Please sign in instead.' });
    return;
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);
  const userId = 'user_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex');
  const displayName = typeof name === 'string' && name.trim() ? name.trim() : normalizedEmail.split('@')[0];

  const newUser = {
    id: userId,
    email: normalizedEmail,
    name: displayName,
    salt,
    hash,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await insertItem('users', newUser);

  if (previousOwnerId && typeof previousOwnerId === 'string' && previousOwnerId !== userId) {
    await migrateOwnerData(previousOwnerId, userId);
  }

  res.status(201).json({
    user: {
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      createdAt: newUser.createdAt,
    },
    message: 'Account created successfully',
  });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const { email, password, previousOwnerId } = req.body || {};

  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' });
    return;
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const user = await findOneItem('users', { email: normalizedEmail });

  if (!user) {
    res.status(401).json({ error: 'No account found with this email. Please create an account.' });
    return;
  }

  const isValid = verifyPassword(String(password), user.salt, user.hash);
  if (!isValid) {
    res.status(401).json({ error: 'Incorrect password. Please try again.' });
    return;
  }

  if (previousOwnerId && typeof previousOwnerId === 'string' && previousOwnerId !== user.id) {
    await migrateOwnerData(previousOwnerId, user.id);
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
    message: 'Signed in successfully',
  });
});

authRouter.get('/me', async (req: Request, res: Response) => {
  const ownerId = req.headers['x-owner-id'] as string;
  if (!ownerId) {
    res.status(401).json({ user: null });
    return;
  }

  const user = await findOneItem('users', { id: ownerId });
  if (!user) {
    res.json({ user: null });
    return;
  }

  res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      createdAt: user.createdAt,
    },
  });
});