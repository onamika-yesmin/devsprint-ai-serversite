import { Schema, model, models, Types } from 'mongoose';

const userSchema = new Schema({ name: { type: String, required: true }, email: { type: String, required: true, unique: true, lowercase: true }, passwordHash: String, avatarUrl: String, googleId: String }, { timestamps: true });
const taskSchema = new Schema({ title: { type: String, required: true }, status: { type: String, enum: ['todo', 'in-progress', 'done'], default: 'todo' }, priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' }, sprint: { type: Number, default: 1 } }, { timestamps: true });
const projectSchema = new Schema({ owner: { type: Schema.Types.ObjectId, ref: 'User', required: true }, title: { type: String, required: true }, shortDescription: { type: String, required: true }, fullDescription: String, deadline: Date, priority: { type: String, enum: ['High', 'Medium', 'Low'], default: 'Medium' }, techStack: { type: [String], default: [] }, imageUrl: String, prdText: String, aiBlueprint: String, tasks: { type: [taskSchema], default: [] } }, { timestamps: true });

export const User = models.User || model('User', userSchema);
export const Project = models.Project || model('Project', projectSchema);
export type AuthRequest = { userId?: Types.ObjectId | string };
