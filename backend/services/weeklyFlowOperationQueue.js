class WeeklyFlowOperationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  enqueue(label, operation) {
    return new Promise((resolve, reject) => {
      this.queue.push({ label, operation, resolve, reject });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing) return;
    this.processing = true;
    while (this.queue.length > 0) {
      const next = this.queue.shift();
      if (!next) continue;
      try {
        const result = await next.operation();
        next.resolve(result);
      } catch (error) {
        next.reject(error);
      }
    }
    this.processing = false;
  }

  getStatus() {
    return {
      processing: this.processing,
      pending: this.queue.length,
    };
  }
}

export const weeklyFlowOperationQueue = new WeeklyFlowOperationQueue();
