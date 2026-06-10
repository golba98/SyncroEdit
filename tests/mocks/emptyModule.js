function WebsocketProvider(...args) {
  if (typeof global !== 'undefined' && typeof global.__mockWebsocketProvider === 'function') {
    return global.__mockWebsocketProvider(...args);
  }
  return {
    awareness: {
      setLocalStateField: () => {},
      on: () => {},
      off: () => {},
      getStates: () => new Map(),
    },
    params: {},
    shouldConnect: false,
    wsconnected: false,
    wsconnecting: false,
    synced: false,
    on: () => {},
    connect: () => {},
    destroy: () => {},
  };
}

function QuillBinding(...args) {
  if (typeof global !== 'undefined' && typeof global.__mockQuillBinding === 'function') {
    return global.__mockQuillBinding(...args);
  }
  return { destroy: () => {} };
}

module.exports = {
  WebsocketProvider,
  QuillBinding,
};
