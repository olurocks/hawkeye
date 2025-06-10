// utils/cashtag.utils.ts
import { Cashtag } from "../models/cashtag.model";
import { Tweet } from "../models/tweet.model";
import { PipelineStage } from 'mongoose';


export class CashtagUtils {
  /**
   * Get trending cashtags based on mention count
   */
  static async getTrendingCashtags(limit: number = 20) {
    try {
      return await Cashtag.find({})
        .sort({ mention_count: -1 })
        .limit(limit)
        .select("cashtag mention_count last_mentioned");
    } catch (error) {
      console.error("Error getting trending cashtags:", error);
      return [];
    }
  }

  /**
   * Get recently mentioned cashtags
   */
  static async getRecentCashtags(limit: number = 20) {
    try {
      return await Cashtag.find({})
        .sort({ last_mentioned: -1 })
        .limit(limit)
        .select("cashtag mention_count last_mentioned");
    } catch (error) {
      console.error("Error getting recent cashtags:", error);
      return [];
    }
  }

  /**
   * Get detailed stats for a specific cashtag
   */
  static async getCashtagDetail(cashtag: string) {
    try {
      const cashtagDoc = await Cashtag.findOne({
        cashtag: cashtag.toUpperCase(),
      });

      if (!cashtagDoc) return null;

      // Get recent tweets mentioning this cashtag
      const recentTweets = await Tweet.find({
        cashtags: { $regex: cashtag, $options: "i" },
      })
        .sort({ created_at: -1 })
        .limit(10)
        .select("tweet_id text username created_at");

      return {
        ...cashtagDoc.toObject(),
        recent_tweets: recentTweets,
      };
    } catch (error) {
      console.error("Error getting cashtag detail:", error);
      return null;
    }
  }

  /**
   * Get cashtags mentioned by a specific author
   */
  static async getCashtagsByAuthor(authorId: string, limit: number = 50) {
    try {
      const cashtags = await Cashtag.find({
        "mentioned_by.author_id": authorId,
      })
        .sort({ "mentioned_by.$.last_mentioned": -1 })
        .limit(limit);

      // Transform to show only relevant author data
      return cashtags.map((cashtag) => {
        const authorMention = cashtag.mentioned_by.find(
          (mention) => mention.author_id === authorId
        );

        return {
          cashtag: cashtag.cashtag,
          total_mentions: cashtag.mention_count,
          author_mentions: authorMention?.mention_count || 0,
          last_mentioned: authorMention?.last_mentioned,
          first_mentioned: cashtag.first_mentioned,
        };
      });
    } catch (error) {
      console.error("Error getting cashtags by author:", error);
      return [];
    }
  }

  /**
   * Get top mentioners across all cashtags
   */
  static async getTopCashtagMentioners(limit: number = 20) {
    try {
      const pipeline:PipelineStage[] = [
        { $unwind: { path: "$mentioned_by" } },
        {
          $group: {
            _id: "$mentioned_by.author_id",
            username: { $first: "$mentioned_by.username" },
            total_mentions: { $sum: "$mentioned_by.mention_count" },
            unique_cashtags: { $addToSet: "$cashtag" },
            last_activity: { $max: "$mentioned_by.last_mentioned" },
          },
        },
        {
          $project: {
            author_id: "$_id",
            username: 1,
            total_mentions: 1,
            unique_cashtags_count: { $size: "$unique_cashtags" },
            last_activity: 1,
            _id: 0,
          },
        },
        { $sort: { total_mentions: -1 } },
        { $limit: limit },
      ];

      return await Cashtag.aggregate(pipeline);
    } catch (error) {
      console.error("Error getting top cashtag mentioners:", error);
      return [];
    }
  }

  /**
   * Get cashtag mention timeline (daily aggregation)
   */
  static async getCashtagTimeline(cashtag: string, days: number = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const pipeline: PipelineStage[] = [
        { $match: { cashtags: { $regex: cashtag, $options: "i" } } },
        { $match: { created_at: { $gte: startDate.toISOString() } } },
        {
          $group: {
            _id: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: { $dateFromString: { dateString: "$created_at" } },
              },
            },
            count: { $sum: 1 },
            unique_authors: { $addToSet: "$author_id" },
          },
        },
        {
          $project: {
            date: "$_id",
            mention_count: "$count",
            unique_authors_count: { $size: "$unique_authors" },
            _id: 0,
          },
        },
        { $sort: { date: 1 } },
      ];

      return await Tweet.aggregate(pipeline);
    } catch (error) {
      console.error("Error getting cashtag timeline:", error);
      return [];
    }
  }

  /**
   * Search cashtags by partial match
   */
  static async searchCashtags(query: string, limit: number = 10) {
    try {
      const searchRegex = new RegExp(query.replace(/^\$/, ""), "i");

      return await Cashtag.find({
        cashtag: { $regex: searchRegex },
      })
        .sort({ mention_count: -1 })
        .limit(limit)
        .select("cashtag mention_count last_mentioned");
    } catch (error) {
      console.error("Error searching cashtags:", error);
      return [];
    }
  }

  /**
   * Get cashtag co-occurrence (cashtags mentioned together)
   */
  static async getCashtagCoOccurrence(cashtag: string, limit: number = 10) {
    try {
      const tweets = await Tweet.find({
        cashtags: { $regex: cashtag, $options: "i" },
        $expr: { $gt: [{ $strLenCP: "$cashtags" }, { $strLenCP: cashtag }] },
      }).select("cashtags");

      const coOccurrences: { [key: string]: number } = {};

      tweets.forEach((tweet) => {
        const cashtags = tweet.cashtags
          .split(", ")
          .map((tag) => tag.trim())
          .filter((tag) => tag.toUpperCase() !== cashtag.toUpperCase());

        cashtags.forEach((otherCashtag) => {
          coOccurrences[otherCashtag] = (coOccurrences[otherCashtag] || 0) + 1;
        });
      });

      return Object.entries(coOccurrences)
        .sort(([, a], [, b]) => b - a)
        .slice(0, limit)
        .map(([cashtag, count]) => ({ cashtag, co_occurrence_count: count }));
    } catch (error) {
      console.error("Error getting cashtag co-occurrence:", error);
      return [];
    }
  }
}
