import { Queue } from "bullmq";
import { redis } from "src/common/queue/redis.connection";

export const automationQueue = new Queue('automation',{
    connection:redis
})