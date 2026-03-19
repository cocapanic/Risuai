# RisuAI Fork - 커스텀 수정 가이드

이 프로젝트는 RisuAI의 포크입니다. 업스트림을 주기적으로 머지하므로, 기존 파일 수정을 최소화하고 새 파일 추가를 우선합니다.

## 프로젝트 개요

- **프레임워크**: Svelte 5 + Vite 7 + Tailwind CSS
- **서버**: Express (server/node/server.cjs), 포트 6001
- **스토리지**: NodeStorage → /api/read, /api/write (RisuSave 바이너리 포맷, msgpackr + gzip)
- **배포**: Docker (node server 모드)
- **접속 환경**: Tailscale/WireGuard 경유 (저대역폭) → 데이터 전송량 최소화 중요

## 포크 수정 사항

### 1. 델타 저장/로딩 (데이터 전송량 감소)

**문제**: 채팅 메시지 1개 추가 시 캐릭터 전체 데이터를 통째로 서버에 전송 (수 MB). Tailscale 경유 시 심한 렉 유발.

**해결**: 블록 단위 델타 저장 + 지연 로딩

#### 새 파일 (충돌 위험 없음)

| 파일 | 역할 |
|------|------|
| `src/ts/storage/forkConfig.ts` | 포크 전용 기능 플래그 (deltaSave, pluginV2 등 on/off) |
| `server/node/deltaRoutes.cjs` | 블록 단위 읽기/쓰기 API (`/api/delta/*`) |
| `src/ts/storage/deltaNodeStorage.ts` | 델타 API 호출 클라이언트 |
| `src/ts/storage/deltaSaveEncoder.ts` | 변경된 블록만 저장하는 인코더 |
| `src/ts/storage/deltaLoadDb.ts` | 블록 단위 로딩 + 매니페스트 파싱 |
| `src/ts/storage/lazyCharacterWatcher.svelte.ts` | 캐릭터 선택 시 해당 데이터만 로딩 |

#### 기존 파일 수정 (최소 변경)

| 파일 | 변경 | 충돌 위험 |
|------|------|-----------|
| `server/node/server.cjs` | 맨 아래에 deltaRoutes 로더 4줄 추가 (try/catch) | 매우 낮음 |
| `src/ts/globalApi.svelte.ts` | import 추가 + saveDb에 if/else 분기 (~15줄, 원본 else에 보존) | 낮음 |
| `src/ts/bootstrap.ts` | lazyCharacterWatcher 초기화 import + 호출 1줄 | 매우 낮음 |

#### 델타 API 엔드포인트 설계

```
POST /api/delta/write-block   - 단일 블록 저장 (header: block-name, block-hash)
GET  /api/delta/read-block    - 단일 블록 읽기 (header: block-name)
POST /api/delta/write-manifest - 매니페스트(블록 목록+해시) 저장
GET  /api/delta/read-manifest  - 매니페스트 읽기
GET  /api/delta/enabled        - 델타 지원 여부 확인
```

#### 저장 흐름 (변경 후)

```
메시지 추가 → changeTracker가 변경된 캐릭터 ID 기록
→ deltaSaveEncoder가 해당 블록만 해시 비교
→ 변경된 블록만 /api/delta/write-block 으로 전송
→ 매니페스트 업데이트
```

#### 로딩 흐름 (변경 후)

```
앱 시작 → 매니페스트 + root 블록만 로딩
→ 캐릭터 목록은 스텁(이름+ID+이미지만) 표시
→ 캐릭터 선택 시 해당 블록만 /api/delta/read-block 으로 가져옴
```

### 2. Plugin 2.0/2.1 재활성화

**문제**: `plugins.svelte.ts`에서 v2.0 플러그인 임포트/실행이 차단됨.

#### 기존 파일 수정

| 파일 | 변경 | 충돌 위험 |
|------|------|-----------|
| `src/ts/plugins/plugins.svelte.ts` ~line 362 | v2.0 임포트 차단에 `globalThis.__FORK_PLUGIN_V2_ENABLED__` 플래그 조건 추가 (+3줄) | 낮음 |
| `src/ts/plugins/plugins.svelte.ts` ~line 897 | v2.0 실행부에 플래그 조건 + `new Function(createRealScript(data))()` 복원 (+5줄) | 낮음 |

플래그는 `forkConfig.ts`에서 `globalThis.__FORK_PLUGIN_V2_ENABLED__ = true`로 설정.

## 작업 순서

1. `forkConfig.ts` (기능 플래그)
2. `deltaRoutes.cjs` + `server.cjs` 수정 (서버 API)
3. `deltaNodeStorage.ts` (클라이언트 API)
4. `deltaSaveEncoder.ts` + `globalApi.svelte.ts` 수정 (델타 저장)
5. `deltaLoadDb.ts` + `globalApi.svelte.ts` 수정 (델타 로딩)
6. `lazyCharacterWatcher.svelte.ts` + `bootstrap.ts` 수정 (지연 로딩)
7. `plugins.svelte.ts` 수정 (플러그인 활성화)

## 업스트림 머지 규칙

- `git rerere` 활성화하여 충돌 해결 캐시
- 새 파일은 절대 충돌하지 않음
- 기존 수정은 전부 원본 코드를 **감싸는 wrapper 패턴** 사용
- server.cjs 수정은 try/catch로 감싸서 deltaRoutes 없어도 서버 정상 기동
- 모든 포크 기능은 `forkConfig.ts` 플래그로 비활성화 가능 (안전 장치)

## 핵심 파일 참조

### 스토리지 레이어
- `src/ts/storage/database.svelte.ts` - 데이터 모델/타입 정의 (70KB+)
- `src/ts/storage/risuSave.ts` - RisuSave 바이너리 인코더/디코더
- `src/ts/storage/autoStorage.ts` - 스토리지 백엔드 라우팅
- `src/ts/storage/nodeStorage.ts` - Node 서버 스토리지 클라이언트

### 저장/로딩 트리거
- `src/ts/globalApi.svelte.ts` - saveDb() 함수, changeTracker (~line 288-460)
- `src/ts/bootstrap.ts` - 앱 초기화, DB 로딩

### 플러그인
- `src/ts/plugins/plugins.svelte.ts` - 플러그인 임포트/실행 (v2.0 차단: ~line 362, ~line 897)

### 서버
- `server/node/server.cjs` - Express 서버, /api/* 엔드포인트

### 채팅 UI
- `src/lib/ChatScreens/DefaultChatScreen.svelte` - 채팅 입력/전송
- `src/lib/ChatScreens/Chats.svelte` - 메시지 렌더링 (가상 스크롤, 30개씩)

## 저장소 구조 참고

서버의 `/app/save/` (docker volume)에 hex 인코딩된 파일명으로 저장:
- `database/database.bin` → 메인 DB (현재 32MB)
- `database/dbbackup-{timestamp}.bin` → 자동 백업 (31MB × 20개 = 620MB, 정리 필요)
- `assets/{hash}.{ext}` → 이미지 파일 (합계 7.8MB)
- 전체 9,175개 파일, 1.6GB (대부분 백업 + 파일시스템 블록 낭비)
