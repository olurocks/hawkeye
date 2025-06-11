import mongoose, { Schema, Document } from "mongoose";

interface IMentionedBy {
  author_id: string;
  username: string;
  mention_count: number;
  last_mentioned: Date;
}

export interface ICashtag extends Document {
  cashtag: string;
  mention_count: number;
  first_mentioned: Date;
  last_mentioned: Date;
  mentioned_by: IMentionedBy[];
}

const MentionedBySchema = new Schema<IMentionedBy>({
  author_id: {
    type: String,
    required: true,
  },
  username: {
    type: String,
    required: true,
  },
  mention_count: {
    type: Number,
    required: true,
    default: 1,
  },
  last_mentioned: {
    type: Date,
    required: true,
  },
});

const CashtagSchema = new Schema<ICashtag>(
  {
    cashtag: {
      type: String,
      required: true,
      unique: true,
      uppercase: true,
      trim: true,
    },
    mention_count: {
      type: Number,
      required: true,
      default: 1,
    },
    first_mentioned: {
      type: Date,
      required: true,
    },
    last_mentioned: {
      type: Date,
      required: true,
    },
    mentioned_by: [MentionedBySchema],
  },
  {
    timestamps: true,
  }
);

CashtagSchema.index({ mention_count: -1 });
CashtagSchema.index({ last_mentioned: -1 });
CashtagSchema.index({ "mentioned_by.author_id": 1 });

export const Cashtag = mongoose.model<ICashtag>("Cashtag", CashtagSchema);
