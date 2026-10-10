// Phone notifications to an agent's owner (Web Push), with a short history.
const push = require('./push');

function tell(agent, { title, body, url, tag }) {
  push.broadcast({
    title, body: String(body || '').slice(0, 180),
    url: url || `/#/agent/${agent.id}`, tag: tag || `${agent.id}:${title}`,
  }, [agent.ownerId]).catch(() => {});
}

module.exports = { tell };
