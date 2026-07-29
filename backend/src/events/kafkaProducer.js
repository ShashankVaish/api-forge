/**
 * kafkaProducer.js
 *
 * This is the piece that backs the resume claim "event-driven model
 * orchestration." Every time the router picks a model and gets a response,
 * we publish an event to Kafka instead of (or in addition to) handling
 * stats/logging synchronously inline in the request path.
 *
 * Why this matters architecturally (good to say in the interview):
 * - Decouples "serve the user's request fast" from "record analytics /
 *   update usage stats / trigger alerts on expensive requests" — those
 *   become async consumers instead of blocking the response.
 * - Multiple consumers can subscribe to the same topic independently:
 *   e.g. one consumer aggregates stats (usageStatsConsumer.js), another
 *   could trigger a Slack alert if a "complex" tier request spikes, another
 *   could feed a data warehouse — without touching server.js at all.
 * - This is the standard reason teams reach for Kafka over just writing to
 *   a DB directly: producers and consumers scale and fail independently.
 *
 * Fails OPEN: if Kafka is unreachable, we log a warning and continue
 * serving requests. Event publishing is fire-and-forget from the request's
 * point of view — a broker outage should never break the actual API call.
 */

const { Kafka } = require("kafkajs");

const KAFKA_BROKER = process.env.KAFKA_BROKER || "localhost:9092";
const TOPIC = process.env.KAFKA_ROUTING_TOPIC || "model-routing-events";

const kafka = new Kafka({
  clientId: "api-forge",
  brokers: [KAFKA_BROKER],
  retry: { retries: 2 },
});

const producer = kafka.producer();
let isConnected = false;
let connectPromise = null;

async function ensureConnected() {
  if (isConnected) return true;
  if (!connectPromise) {
    connectPromise = producer
      .connect()
      .then(() => {
        isConnected = true;
        console.log(`[kafkaProducer] Connected to Kafka at ${KAFKA_BROKER}`);
      })
      .catch((err) => {
        console.warn("[kafkaProducer] Could not connect to Kafka, events will be skipped:", err.message);
      });
  }
  await connectPromise;
  return isConnected;
}

/**
 * Publishes a routing-decision event. Non-blocking from the caller's
 * perspective in the sense that failures are swallowed (logged, not thrown) —
 * we never want an analytics pipeline hiccup to break a user-facing request.
 */
async function publishRoutingEvent(event) {
  try {
    const connected = await ensureConnected();
    if (!connected) return;

    await producer.send({
      topic: TOPIC,
      messages: [
        {
          key: event.routing?.tier || "unknown",
          value: JSON.stringify({
            ...event,
            publishedAt: new Date().toISOString(),
          }),
        },
      ],
    });
  } catch (err) {
    console.warn("[kafkaProducer] publishRoutingEvent failed:", err.message);
  }
}

module.exports = { publishRoutingEvent };
