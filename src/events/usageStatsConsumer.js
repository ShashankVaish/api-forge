/**
 * usageStatsConsumer.js
 *
 * A standalone consumer process — run this SEPARATELY from the main API
 * server (`node src/events/usageStatsConsumer.js`). It subscribes to the
 * same Kafka topic the producer publishes to, and independently builds up
 * usage stats from the event stream.
 *
 * This is the concrete proof-of-concept for "event-driven orchestration":
 * the API server doesn't know or care who's listening to these events —
 * it just publishes them. This consumer happens to track stats, but you
 * could run a second consumer with a different consumer group (e.g.
 * "alerting-service") reading the exact same topic for a totally different
 * purpose, without touching server.js.
 */

const { Kafka } = require("kafkajs");

const KAFKA_BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const TOPIC = process.env.KAFKA_ROUTING_TOPIC || "model-routing-events";

const kafka = new Kafka({
  clientId: "api-forge-stats-consumer",
  brokers: [KAFKA_BROKER],
});

const consumer = kafka.consumer({ groupId: "usage-stats-group" });

const tierCounts = { simple: 0, moderate: 0, complex: 0 };

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });
  console.log(`[usageStatsConsumer] Listening on topic "${TOPIC}"...`);

  await consumer.run({
    eachMessage: async ({ message }) => {
      try {
        const event = JSON.parse(message.value.toString());
        const tier = event.routing?.tier || "unknown";
        tierCounts[tier] = (tierCounts[tier] || 0) + 1;

        console.log(
          `[usageStatsConsumer] event received -> tier=${tier} model=${event.routing?.model} ` +
          `score=${event.routing?.complexityScore} | running totals:`, tierCounts
        );
      } catch (err) {
        console.warn("[usageStatsConsumer] failed to process message:", err.message);
      }
    },
  });
}

run().catch((err) => {
  console.error("[usageStatsConsumer] fatal error:", err.message);
  process.exit(1);
});
