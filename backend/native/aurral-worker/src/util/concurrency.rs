use std::future::Future;
use std::sync::Arc;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

pub async fn map_with_concurrency<T, F, Fut, R>(
    items: Vec<T>,
    concurrency: usize,
    worker: F,
) -> Vec<R>
where
    T: Send + 'static,
    F: Fn(T) -> Fut + Send + Sync + 'static,
    Fut: Future<Output = R> + Send + 'static,
    R: Send + 'static,
{
    let limit = concurrency.max(1);
    if items.is_empty() {
        return Vec::new();
    }
    let worker = Arc::new(worker);
    let semaphore = Arc::new(Semaphore::new(limit));
    let mut join_set = JoinSet::new();
    for (index, item) in items.into_iter().enumerate() {
        let worker = worker.clone();
        let semaphore = semaphore.clone();
        join_set.spawn(async move {
            let _permit = semaphore.acquire().await.expect("semaphore");
            let value = worker(item).await;
            (index, value)
        });
    }
    let mut results = Vec::new();
    while let Some(joined) = join_set.join_next().await {
        if let Ok(pair) = joined {
            results.push(pair);
        }
    }
    results.sort_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, value)| value).collect()
}
