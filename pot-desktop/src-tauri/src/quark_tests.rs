use super::*;
use std::io::Read;
use std::sync::Arc;
use std::thread::JoinHandle;
use tiny_http::{Header, Request, Response, Server};
type Step = Box<dyn Fn(Request, &str) + Send>;
struct Fixture {
    drive: Drive,
    server: Arc<Server>,
    worker: Option<JoinHandle<()>>,
}
impl Fixture {
    fn new(steps: Vec<Step>) -> Self {
        let root = std::env::temp_dir().join(format!("pot-openlist-test-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let server = Arc::new(Server::http("127.0.0.1:0").unwrap());
        let base = format!("http://{}", server.server_addr());
        let drive = Drive::new(root).unwrap();
        drive.configure(&json!({ "url": format!("{base}/openlist"), "token": "test-service-secret", "directory": "/夸克/备份" })).unwrap();
        let listener = server.clone();
        let worker = std::thread::spawn(move || {
            for step in steps {
                step(
                    listener
                        .recv_timeout(Duration::from_secs(10))
                        .unwrap()
                        .expect("expected HTTP request"),
                    &base,
                );
            }
        });
        Self {
            drive,
            server,
            worker: Some(worker),
        }
    }
    fn verify(mut self) {
        self.worker.take().unwrap().join().unwrap();
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.unblock();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
        std::fs::remove_dir_all(&self.drive.root).unwrap();
    }
}
fn header<'a>(r: &'a Request, key: &str) -> Option<&'a str> {
    r.headers()
        .iter()
        .find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(key))
        .map(|h| h.value.as_str())
}
fn body(r: &mut Request) -> Value {
    let mut bytes = Vec::new();
    r.as_reader().read_to_end(&mut bytes).unwrap();
    serde_json::from_slice(&bytes).unwrap()
}
fn check(r: &Request, endpoint: &str, method: &str) {
    assert_eq!(r.url(), format!("/openlist/api/fs/{endpoint}"));
    assert_eq!(r.method().as_str(), method);
    assert_eq!(header(r, "Authorization"), Some("test-service-secret"));
    assert!(header(r, "Cookie").is_none());
    assert!(header(r, "x-pan-token").is_none());
}
fn respond(r: Request, data: Value) {
    r.respond(Response::from_string(
        json!({ "code": 200, "data": data }).to_string(),
    ))
    .unwrap();
}

#[test]
fn configuration_keeps_tokens_native_and_rejects_invalid_urls_and_paths() {
    let fixture = Fixture::new(vec![]);
    assert!(!fixture
        .drive
        .state()
        .unwrap()
        .to_string()
        .contains("test-service-secret"));
    assert_eq!(fixture.drive.state().unwrap()["has_token"], true);
    for path in ["/", "relative", "/a/../b", "/a//b", "/a\\b"] {
        assert!(directory(path).is_err());
    }
    for url in [
        "http://example.com",
        "https://u:p@example.com",
        "https://example.com?token=secret",
    ] {
        assert!(service_url(url).is_err());
    }
    assert!(fixture
        .drive
        .configure(
            &json!({ "url": "https://new-service.example", "directory": "/backup", "token": "" })
        )
        .is_err());
    let old = fixture.drive.settings().unwrap();
    fixture
        .drive
        .configure(&json!({ "url": old.url, "directory": "/new-backup", "token": "" }))
        .unwrap();
    assert_eq!(
        fixture.drive.settings().unwrap().token,
        "test-service-secret"
    );
    fixture.verify();
}

#[test]
fn lists_pages_and_filters_zip_files_without_losing_old_backup_names() {
    let fixture = Fixture::new(vec![
        Box::new(|mut r, _| {
            check(&r, "list", "POST");
            let value = body(&mut r);
            assert_eq!(value["path"], "/夸克/备份");
            assert_eq!(value["page"], 1);
            let items: Vec<_> = (0..100)
                .map(|i| json!({ "name": format!("old-{i}.zip"), "is_dir": false }))
                .collect();
            respond(r, json!({ "total":102,"content":items }));
        }),
        Box::new(|mut r, _| {
            check(&r, "list", "POST");
            assert_eq!(body(&mut r)["page"], 2);
            respond(
                r,
                json!({ "total":102,"content":[{ "name":"folder.zip","is_dir":true },{ "name":"text.txt","is_dir":false }] }),
            );
        }),
    ]);
    let files = tauri::async_runtime::block_on(fixture.drive.list()).unwrap();
    assert_eq!(files.as_array().unwrap().len(), 100);
    fixture.verify();
}

#[test]
fn upload_sends_encoded_path_raw_zip_and_waits_for_synchronous_success() {
    let fixture = Fixture::new(vec![Box::new(|mut r, _| {
        check(&r, "put", "PUT");
        assert_eq!(header(&r, "As-Task"), Some("false"));
        assert_eq!(header(&r, "Overwrite"), Some("false"));
        assert_eq!(
            header(&r, "File-Path"),
            Some("%2F%E5%A4%B8%E5%85%8B%2F%E5%A4%87%E4%BB%BD%2Fbackup.zip")
        );
        let mut received = Vec::new();
        r.as_reader().read_to_end(&mut received).unwrap();
        assert_eq!(received, b"zip-data");
        respond(r, Value::Null);
    })]);
    let path = fixture.drive.root.join("backup.zip");
    std::fs::write(&path, b"zip-data").unwrap();
    tauri::async_runtime::block_on(fixture.drive.upload(&path, "backup.zip")).unwrap();
    fixture.verify();
}

#[test]
fn asynchronous_upload_and_http_200_business_errors_are_not_success() {
    for queued in [true, false] {
        let fixture = Fixture::new(vec![Box::new(move |r, _| {
            check(&r, "put", "PUT");
            let data = if queued {
                json!({"code":200,"data":{"task":{"id":"pending"}}})
            } else {
                json!({"code":403,"message":"test-service-secret"})
            };
            r.respond(Response::from_string(data.to_string())).unwrap();
        })]);
        let path = fixture.drive.root.join("backup.zip");
        std::fs::write(&path, b"zip").unwrap();
        let message = tauri::async_runtime::block_on(fixture.drive.upload(&path, "backup.zip"))
            .unwrap_err()
            .to_string();
        assert!(!message.contains("test-service-secret"));
        fixture.verify();
    }
}

#[test]
fn download_uses_service_proxy_with_token_and_validates_length() {
    let fixture = Fixture::new(vec![
        Box::new(|mut r, base| {
            check(&r, "get", "POST");
            assert_eq!(body(&mut r)["path"], "/夸克/备份/backup.zip");
            respond(
                r,
                json!({"raw_url":format!("{base}/openlist/p/backup.zip?sign=download-sign"),"size":3,"is_dir":false}),
            );
        }),
        Box::new(|r, _| {
            assert_eq!(r.url(), "/openlist/p/backup.zip?sign=download-sign");
            assert_eq!(header(&r, "Authorization"), Some("test-service-secret"));
            r.respond(Response::from_data(b"zip".to_vec())).unwrap();
        }),
    ]);
    assert_eq!(
        tauri::async_runtime::block_on(fixture.drive.download("backup.zip")).unwrap(),
        b"zip"
    );
    fixture.verify();
}

#[test]
fn cross_origin_download_redirect_never_forwards_service_credentials() {
    let destination = Arc::new(Server::http("127.0.0.1:0").unwrap());
    let url = format!("http://{}/backup.zip", destination.server_addr());
    let listener = destination.clone();
    let worker = std::thread::spawn(move || {
        let r = listener
            .recv_timeout(Duration::from_secs(10))
            .unwrap()
            .unwrap();
        assert!(header(&r, "Authorization").is_none());
        assert!(header(&r, "Cookie").is_none());
        r.respond(Response::from_data(b"zip".to_vec())).unwrap();
    });
    let fixture = Fixture::new(vec![
        Box::new(|r, base| {
            check(&r, "get", "POST");
            respond(
                r,
                json!({"raw_url":format!("{base}/openlist/download"),"size":3}),
            );
        }),
        Box::new(move |r, _| {
            assert_eq!(header(&r, "Authorization"), Some("test-service-secret"));
            r.respond(
                Response::from_string("")
                    .with_status_code(302)
                    .with_header(Header::from_bytes("Location", url.as_str()).unwrap()),
            )
            .unwrap();
        }),
    ]);
    assert_eq!(
        tauri::async_runtime::block_on(fixture.drive.download("backup.zip")).unwrap(),
        b"zip"
    );
    fixture.verify();
    worker.join().unwrap();
}

#[test]
fn delete_is_scoped_to_one_zip_and_rejects_traversal() {
    let fixture = Fixture::new(vec![Box::new(|mut r, _| {
        check(&r, "remove", "POST");
        assert_eq!(
            body(&mut r),
            json!({"dir":"/夸克/备份","names":["backup.zip"]})
        );
        respond(r, Value::Null);
    })]);
    assert!(tauri::async_runtime::block_on(fixture.drive.remove("../backup.zip")).is_err());
    tauri::async_runtime::block_on(fixture.drive.remove("backup.zip")).unwrap();
    fixture.verify();
}

#[test]
fn incomplete_pages_and_truncated_downloads_are_errors() {
    let fixture = Fixture::new(vec![
        Box::new(|r, _| {
            check(&r, "list", "POST");
            respond(r, json!({"total":200,"content":[]}));
        }),
        Box::new(|r, base| {
            check(&r, "get", "POST");
            respond(
                r,
                json!({"raw_url":format!("{base}/openlist/download"),"size":10}),
            );
        }),
        Box::new(|r, _| {
            r.respond(Response::from_data(b"zip".to_vec())).unwrap();
        }),
    ]);
    assert!(tauri::async_runtime::block_on(fixture.drive.list()).is_err());
    assert!(tauri::async_runtime::block_on(fixture.drive.download("backup.zip")).is_err());
    fixture.verify();
}
