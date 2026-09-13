import { useEffect } from 'react';

export type UiLanguage = 'en' | 'zh-CN' | 'ja' | 'fr' | 'ko';

export const UI_LANGUAGES: {
  value: UiLanguage;
  label: string;
  nativeLabel: string;
}[] = [
  { value: 'en', label: 'English', nativeLabel: 'English' },
  { value: 'zh-CN', label: 'Chinese', nativeLabel: '简体中文' },
  { value: 'ja', label: 'Japanese', nativeLabel: '日本語' },
  { value: 'fr', label: 'French', nativeLabel: 'Français' },
  { value: 'ko', label: 'Korean', nativeLabel: '한국어' },
];

type LocalizedValues = [
  english: string,
  japanese: string,
  french: string,
  korean: string,
];

const phrases: Record<string, LocalizedValues> = {
  总览: ['Overview', '概要', 'Vue d’ensemble', '개요'],
  代理组: ['Proxy groups', 'プロキシグループ', 'Groupes proxy', '프록시 그룹'],
  全部节点: ['All nodes', 'すべてのノード', 'Tous les nœuds', '모든 노드'],
  健康检测: [
    'Health checks',
    'ヘルスチェック',
    'Contrôles de santé',
    '상태 검사',
  ],
  运行日志: ['Runtime logs', '実行ログ', 'Journaux d’exécution', '런타임 로그'],
  系统设置: ['Settings', 'システム設定', 'Paramètres système', '시스템 설정'],
  系统: ['System', 'システム', 'Système', '시스템'],
  管理: ['Management', '管理', 'Gestion', '관리'],
  刷新: ['Refresh', '更新', 'Actualiser', '새로고침'],
  新建代理组: [
    'New proxy group',
    'プロキシグループを作成',
    'Nouveau groupe proxy',
    '새 프록시 그룹',
  ],
  真实引擎运行中: [
    'Real engine running',
    '実エンジン稼働中',
    'Moteur réel actif',
    '실제 엔진 실행 중',
  ],
  引擎不可用: [
    'Engine unavailable',
    'エンジン利用不可',
    'Moteur indisponible',
    '엔진 사용 불가',
  ],
  真实流量模式: [
    'Live traffic mode',
    '実トラフィックモード',
    'Mode trafic réel',
    '실시간 트래픽 모드',
  ],
  引擎异常: ['Engine error', 'エンジン異常', 'Erreur du moteur', '엔진 오류'],
  '管理不同地区的监听端口、代理节点与切换策略': [
    'Manage regional listeners, proxy nodes, and failover policies',
    '地域別リスナー、プロキシノード、切替ポリシーを管理',
    'Gérez les ports régionaux, les nœuds proxy et les stratégies de bascule',
    '지역별 수신 포트, 프록시 노드 및 전환 정책 관리',
  ],
  代理组已停用: [
    'Proxy group disabled',
    'プロキシグループを無効化しました',
    'Groupe proxy désactivé',
    '프록시 그룹 비활성화됨',
  ],
  代理组已启用: [
    'Proxy group enabled',
    'プロキシグループを有効化しました',
    'Groupe proxy activé',
    '프록시 그룹 활성화됨',
  ],
  节点已停用: [
    'Node disabled',
    'ノードを無効化しました',
    'Nœud désactivé',
    '노드 비활성화됨',
  ],
  节点已启用: [
    'Node enabled',
    'ノードを有効化しました',
    'Nœud activé',
    '노드 활성화됨',
  ],
  真实引擎已重载: [
    'Engine reloaded',
    'エンジンを再読み込みしました',
    'Moteur rechargé',
    '엔진 다시 로드됨',
  ],
  节点: ['Nodes', 'ノード', 'Nœuds', '노드'],
  策略: ['Policy', 'ポリシー', 'Stratégie', '정책'],
  检测: ['Checks', 'チェック', 'Contrôles', '검사'],
  配置: ['Configuration', '設定', 'Configuration', '구성'],
  节点列表: ['Node list', 'ノード一覧', 'Liste des nœuds', '노드 목록'],
  节点凭据与完整配置加密保存在本机: [
    'Credentials and full node settings are encrypted locally',
    '認証情報と完全な設定はローカルで暗号化されます',
    'Les identifiants et la configuration complète sont chiffrés localement',
    '자격 증명과 전체 구성은 로컬에 암호화되어 저장됩니다',
  ],
  添加节点: ['Add node', 'ノードを追加', 'Ajouter un nœud', '노드 추가'],
  修改: ['Edit', '編集', 'Modifier', '수정'],
  删除: ['Delete', '削除', 'Supprimer', '삭제'],
  尚无节点: ['No nodes yet', 'ノードがありません', 'Aucun nœud', '노드 없음'],
  '可用基础表单、出站 JSON 或分享链接添加代理节点。': [
    'Add nodes with the basic form, outbound JSON, or a share link.',
    '基本フォーム、アウトバウンド JSON、共有リンクからノードを追加できます。',
    'Ajoutez des nœuds via le formulaire, un JSON sortant ou un lien de partage.',
    '기본 양식, 아웃바운드 JSON 또는 공유 링크로 노드를 추가할 수 있습니다.',
  ],
  保存节点选择: [
    'Save node selection',
    'ノード選択を保存',
    'Enregistrer la sélection',
    '노드 선택 저장',
  ],
  保存策略设置: [
    'Save policy',
    'ポリシーを保存',
    'Enregistrer la stratégie',
    '정책 저장',
  ],
  删除整个代理组: [
    'Delete proxy group',
    'プロキシグループを削除',
    'Supprimer le groupe proxy',
    '프록시 그룹 삭제',
  ],
  立即真实检测: [
    'Run live check now',
    '今すぐ実チェック',
    'Lancer le contrôle réel',
    '지금 실제 검사',
  ],
  保存检测设置: [
    'Save check settings',
    'チェック設定を保存',
    'Enregistrer les contrôles',
    '검사 설정 저장',
  ],
  '每个代理组对应一个本地监听端口，后续可添加任意数量的代理节点。': [
    'Each proxy group owns a local listener and can contain any number of nodes.',
    '各グループはローカルポートを持ち、任意数のノードを追加できます。',
    'Chaque groupe possède un port local et peut contenir autant de nœuds que nécessaire.',
    '각 그룹은 로컬 수신 포트를 가지며 원하는 만큼 노드를 추가할 수 있습니다.',
  ],
  取消: ['Cancel', 'キャンセル', 'Annuler', '취소'],
  创建代理组: [
    'Create group',
    'グループを作成',
    'Créer le groupe',
    '그룹 생성',
  ],
  添加代理节点: [
    'Add proxy node',
    'プロキシノードを追加',
    'Ajouter un nœud proxy',
    '프록시 노드 추가',
  ],
  '支持基础配置、出站 JSON 和分享链接；敏感字段都会加密保存。': [
    'Use the basic form, outbound JSON, or a share link. Sensitive fields are encrypted.',
    '基本設定、アウトバウンド JSON、共有リンクに対応し、機密項目は暗号化されます。',
    'Formulaire, JSON sortant et lien de partage sont pris en charge. Les champs sensibles sont chiffrés.',
    '기본 구성, 아웃바운드 JSON 및 공유 링크를 지원하며 민감한 필드는 암호화됩니다.',
  ],
  修改代理节点: [
    'Edit proxy node',
    'プロキシノードを編集',
    'Modifier le nœud proxy',
    '프록시 노드 수정',
  ],
  '可切换配置来源并修改完整凭据；保存后会校验并平滑重载真实引擎。': [
    'Change the configuration source and full credentials. Saving validates and safely reloads the engine.',
    '設定元と完全な認証情報を変更できます。保存時に検証し、安全に再読み込みします。',
    'Modifiez la source et les identifiants complets. L’enregistrement valide puis recharge le moteur sans interruption.',
    '구성 소스와 전체 자격 증명을 변경할 수 있으며 저장 시 검증 후 안전하게 다시 로드합니다.',
  ],
  保存并重载: [
    'Save and reload',
    '保存して再読み込み',
    'Enregistrer et recharger',
    '저장 후 다시 로드',
  ],
  关闭: ['Close', '閉じる', 'Fermer', '닫기'],
  节点名称: ['Node name', 'ノード名', 'Nom du nœud', '노드 이름'],
  负载权重: ['Load weight', '負荷ウェイト', 'Poids de charge', '부하 가중치'],
  故障优先级: [
    'Failover priority',
    'フェイルオーバー優先度',
    'Priorité de bascule',
    '장애 조치 우선순위',
  ],
  启用此节点: [
    'Enable this node',
    'このノードを有効化',
    'Activer ce nœud',
    '이 노드 활성화',
  ],
  '停用后不会参与检测、选路和连接分配': [
    'Disabled nodes are excluded from checks, routing, and connections',
    '無効なノードはチェック、経路選択、接続割当から除外されます',
    'Un nœud désactivé est exclu des contrôles, du routage et des connexions',
    '비활성 노드는 검사, 경로 선택 및 연결 할당에서 제외됩니다',
  ],
  基础配置: [
    'Basic configuration',
    '基本設定',
    'Configuration de base',
    '기본 구성',
  ],
  分享链接: ['Share link', '共有リンク', 'Lien de partage', '공유 링크'],
  '出站 JSON': [
    'Outbound JSON',
    'アウトバウンド JSON',
    'JSON sortant',
    '아웃바운드 JSON',
  ],
  协议: ['Protocol', 'プロトコル', 'Protocole', '프로토콜'],
  服务器地址: [
    'Server address',
    'サーバーアドレス',
    'Adresse du serveur',
    '서버 주소',
  ],
  端口: ['Port', 'ポート', 'Port', '포트'],
  加密方式: ['Encryption', '暗号方式', 'Chiffrement', '암호화'],
  密码: ['Password', 'パスワード', 'Mot de passe', '비밀번호'],
  '密码（可选）': [
    'Password (optional)',
    'パスワード（任意）',
    'Mot de passe (facultatif)',
    '비밀번호(선택)',
  ],
  '用户名（可选）': [
    'Username (optional)',
    'ユーザー名（任意）',
    'Nom d’utilisateur (facultatif)',
    '사용자 이름(선택)',
  ],
  传输与安全: [
    'Transport and security',
    'トランスポートとセキュリティ',
    'Transport et sécurité',
    '전송 및 보안',
  ],
  只显示当前协议和传输方式需要的字段: [
    'Only fields required by the selected protocol and transport are shown',
    '選択したプロトコルと転送方式に必要な項目のみ表示します',
    'Seuls les champs requis par le protocole et le transport sont affichés',
    '선택한 프로토콜과 전송 방식에 필요한 필드만 표시됩니다',
  ],
  传输方式: ['Transport', '転送方式', 'Transport', '전송 방식'],
  安全: ['Security', 'セキュリティ', 'Sécurité', '보안'],
  无: ['None', 'なし', 'Aucun', '없음'],
  路径: ['Path', 'パス', 'Chemin', '경로'],
  默认使用服务器地址: [
    'Uses the server address by default',
    '既定ではサーバーアドレスを使用',
    'Utilise l’adresse du serveur par défaut',
    '기본적으로 서버 주소 사용',
  ],
  浏览器指纹: [
    'Browser fingerprint',
    'ブラウザ指紋',
    'Empreinte du navigateur',
    '브라우저 지문',
  ],
  '不启用 uTLS': [
    'Disable uTLS',
    'uTLS を無効化',
    'Désactiver uTLS',
    'uTLS 비활성화',
  ],
  允许不安全证书: [
    'Allow insecure certificates',
    '安全でない証明書を許可',
    'Autoriser les certificats non sécurisés',
    '안전하지 않은 인증서 허용',
  ],
  仅在确认服务端证书情况时启用: [
    'Enable only when you understand the server certificate',
    'サーバー証明書を確認した場合のみ有効にしてください',
    'À activer uniquement après vérification du certificat serveur',
    '서버 인증서를 확인한 경우에만 활성화하세요',
  ],
  'Reality 公钥': [
    'Reality public key',
    'Reality 公開鍵',
    'Clé publique Reality',
    'Reality 공개 키',
  ],
  'Hysteria2 参数': [
    'Hysteria2 settings',
    'Hysteria2 設定',
    'Paramètres Hysteria2',
    'Hysteria2 설정',
  ],
  '上行 Mbps（0 为自动）': [
    'Upload Mbps (0 = auto)',
    '上り Mbps（0 = 自動）',
    'Débit montant Mbps (0 = auto)',
    '업로드 Mbps(0 = 자동)',
  ],
  '下行 Mbps（0 为自动）': [
    'Download Mbps (0 = auto)',
    '下り Mbps（0 = 自動）',
    'Débit descendant Mbps (0 = auto)',
    '다운로드 Mbps(0 = 자동)',
  ],
  混淆: ['Obfuscation', '難読化', 'Obfuscation', '난독화'],
  混淆密码: [
    'Obfuscation password',
    '難読化パスワード',
    'Mot de passe d’obfuscation',
    '난독화 비밀번호',
  ],
  代理组名称: ['Group name', 'グループ名', 'Nom du groupe', '그룹 이름'],
  地区代码: ['Region code', '地域コード', 'Code région', '지역 코드'],
  监听地址: ['Listen address', '待受アドレス', 'Adresse d’écoute', '수신 주소'],
  监听端口: ['Listen port', '待受ポート', 'Port d’écoute', '수신 포트'],
  启用代理组: [
    'Enable proxy group',
    'プロキシグループを有効化',
    'Activer le groupe proxy',
    '프록시 그룹 활성화',
  ],
  运行模式: [
    'Operating mode',
    '動作モード',
    'Mode de fonctionnement',
    '작동 모드',
  ],
  负载均衡: [
    'Load balancing',
    '負荷分散',
    'Équilibrage de charge',
    '부하 분산',
  ],
  故障回退: ['Failover', 'フェイルオーバー', 'Bascule', '장애 조치'],
  延迟优选: ['Lowest latency', '低遅延優先', 'Latence minimale', '최저 지연'],
  指定节点: ['Fixed node', '固定ノード', 'Nœud fixe', '지정 노드'],
  在健康节点之间分配连接: [
    'Distribute connections across healthy nodes',
    '正常なノード間で接続を分散',
    'Répartit les connexions entre les nœuds sains',
    '정상 노드 간 연결 분산',
  ],
  主节点故障后按优先级切换: [
    'Switch by priority when the primary fails',
    'プライマリ障害時に優先度順で切替',
    'Bascule par priorité après panne du primaire',
    '기본 노드 장애 시 우선순위에 따라 전환',
  ],
  选择延迟最低的健康节点: [
    'Select the healthy node with the lowest latency',
    '最も遅延の低い正常ノードを選択',
    'Sélectionne le nœud sain à la latence la plus faible',
    '지연이 가장 낮은 정상 노드 선택',
  ],
  固定使用手动指定的节点: [
    'Always use the manually selected node',
    '手動選択したノードを固定使用',
    'Utilise toujours le nœud sélectionné',
    '수동 지정 노드만 사용',
  ],
  均衡算法: [
    'Balancing algorithm',
    '分散アルゴリズム',
    'Algorithme d’équilibrage',
    '분산 알고리즘',
  ],
  加权最少连接: [
    'Weighted least connections',
    '重み付き最小接続',
    'Moins de connexions pondéré',
    '가중 최소 연결',
  ],
  加权轮询: [
    'Weighted round robin',
    '重み付きラウンドロビン',
    'Tourniquet pondéré',
    '가중 라운드 로빈',
  ],
  按权重随机: [
    'Weighted random',
    '重み付きランダム',
    'Aléatoire pondéré',
    '가중 무작위',
  ],
  此模式不使用均衡算法: [
    'This mode does not use a balancing algorithm',
    'このモードでは分散アルゴリズムを使用しません',
    'Ce mode n’utilise pas d’algorithme d’équilibrage',
    '이 모드는 분산 알고리즘을 사용하지 않습니다',
  ],
  '检测地址（每行一个）': [
    'Probe URLs (one per line)',
    'チェック URL（1 行に 1 件）',
    'URL de contrôle (une par ligne)',
    '검사 URL(줄마다 하나)',
  ],
  '检测间隔（秒）': [
    'Check interval (seconds)',
    'チェック間隔（秒）',
    'Intervalle de contrôle (secondes)',
    '검사 간격(초)',
  ],
  '超时（秒）': [
    'Timeout (seconds)',
    'タイムアウト（秒）',
    'Délai d’attente (secondes)',
    '시간 초과(초)',
  ],
  连续失败阈值: [
    'Failure threshold',
    '連続失敗しきい値',
    'Seuil d’échec',
    '연속 실패 임계값',
  ],
  连续恢复阈值: [
    'Recovery threshold',
    '連続復旧しきい値',
    'Seuil de rétablissement',
    '연속 복구 임계값',
  ],
  '延迟切换容差（ms）': [
    'Latency switch tolerance (ms)',
    '遅延切替許容値（ms）',
    'Tolérance de latence (ms)',
    '지연 전환 허용치(ms)',
  ],
  真实数据平面在线: [
    'Live data plane online',
    '実データプレーン稼働中',
    'Plan de données réel actif',
    '실제 데이터 플레인 온라인',
  ],
  数据平面异常: [
    'Data plane error',
    'データプレーン異常',
    'Erreur du plan de données',
    '데이터 플레인 오류',
  ],
  重载引擎: [
    'Reload engine',
    'エンジンを再読み込み',
    'Recharger le moteur',
    '엔진 다시 로드',
  ],
  实时双向吞吐: [
    'Live bidirectional throughput',
    'リアルタイム双方向スループット',
    'Débit bidirectionnel en temps réel',
    '실시간 양방향 처리량',
  ],
  健康节点: ['Healthy nodes', '正常ノード', 'Nœuds sains', '정상 노드'],
  平均延迟: ['Average latency', '平均遅延', 'Latence moyenne', '평균 지연'],
  '真实 HTTP 探测': [
    'Real HTTP probes',
    '実 HTTP チェック',
    'Sondes HTTP réelles',
    '실제 HTTP 검사',
  ],
  活动连接: [
    'Active connections',
    'アクティブ接続',
    'Connexions actives',
    '활성 연결',
  ],
  流量趋势: [
    'Traffic trend',
    'トラフィック推移',
    'Tendance du trafic',
    '트래픽 추이',
  ],
  '按真实采样间隔计算速率，长时段自动降采样': [
    'Rates use actual sample intervals; long ranges are downsampled automatically',
    '実際の間隔で速度を算出し、長期間は自動でダウンサンプリングします',
    'Les débits utilisent l’intervalle réel ; les longues périodes sont agrégées automatiquement',
    '실제 샘플 간격으로 속도를 계산하며 긴 기간은 자동 다운샘플링됩니다',
  ],
  上行: ['Upload', '上り', 'Montant', '업로드'],
  下行: ['Download', '下り', 'Descendant', '다운로드'],
  端口流量排行: [
    'Traffic by port',
    'ポート別トラフィック',
    'Trafic par port',
    '포트별 트래픽',
  ],
  '代理端口产生流量后，这里会分别显示上行与下行速率。': [
    'Upload and download rates appear here when proxy ports carry traffic.',
    'プロキシポートに通信が発生すると、上り・下り速度が表示されます。',
    'Les débits montant et descendant apparaissent ici lorsque les ports transportent du trafic.',
    '프록시 포트에 트래픽이 발생하면 업로드 및 다운로드 속도가 표시됩니다.',
  ],
  正在采集真实流量: [
    'Collecting live traffic',
    '実トラフィックを収集中',
    'Collecte du trafic réel',
    '실제 트래픽 수집 중',
  ],
  '读取采样数据...': [
    'Loading samples…',
    'サンプルを読み込み中…',
    'Chargement des échantillons…',
    '샘플 불러오는 중…',
  ],
  '跨代理组查看、检测并修改完整节点配置': [
    'View, test, and edit nodes across all proxy groups',
    '全グループのノードを表示・検査・編集',
    'Affichez, testez et modifiez les nœuds de tous les groupes',
    '모든 그룹의 노드를 조회, 검사 및 수정',
  ],
  真实检测: ['Live check', '実チェック', 'Contrôle réel', '실제 검사'],
  待检测: ['Pending', '未チェック', 'En attente', '검사 대기'],
  待确认: ['Unconfirmed', '未確認', 'À confirmer', '확인 대기'],
  失败: ['Failed', '失敗', 'Échec', '실패'],
  没有启用节点: [
    'No enabled nodes',
    '有効なノードがありません',
    'Aucun nœud actif',
    '활성화된 노드 없음',
  ],
  节点健康检测: [
    'Node health check',
    'ノードヘルスチェック',
    'Contrôle de santé des nœuds',
    '노드 상태 검사',
  ],
  '全部代理组 · 真实链路检测': [
    'All proxy groups · live path check',
    '全プロキシグループ · 実経路チェック',
    'Tous les groupes · contrôle du chemin réel',
    '모든 프록시 그룹 · 실제 경로 검사',
  ],
  正在建立真实代理隧道: [
    'Establishing a real proxy tunnel',
    '実プロキシトンネルを確立中',
    'Établissement du tunnel proxy réel',
    '실제 프록시 터널 연결 중',
  ],
  代理握手: [
    'Proxy handshake',
    'プロキシハンドシェイク',
    'Négociation proxy',
    '프록시 핸드셰이크',
  ],
  访问检测地址: [
    'Access probe URL',
    'チェック URL にアクセス',
    'Accès à l’URL de contrôle',
    '검사 URL 접속',
  ],
  检测完成: ['Check complete', 'チェック完了', 'Contrôle terminé', '검사 완료'],
  检测失败: ['Check failed', 'チェック失敗', 'Échec du contrôle', '검사 실패'],
  没有可检测节点: [
    'No nodes available for checking',
    'チェック可能なノードがありません',
    'Aucun nœud à contrôler',
    '검사 가능한 노드 없음',
  ],
  核心运行日志: [
    'Core runtime logs',
    'コア実行ログ',
    'Journaux du cœur',
    '코어 런타임 로그',
  ],
  配置与检测事件: [
    'Configuration and check events',
    '設定・チェックイベント',
    'Événements de configuration et de contrôle',
    '구성 및 검사 이벤트',
  ],
  实时运行日志: [
    'Live runtime logs',
    'リアルタイム実行ログ',
    'Journaux en temps réel',
    '실시간 런타임 로그',
  ],
  '按进程来源、等级和关键字检索已保留的日志': [
    'Search retained logs by process, level, and keyword',
    'プロセス、レベル、キーワードで保存ログを検索',
    'Recherchez les journaux par processus, niveau et mot-clé',
    '프로세스, 수준 및 키워드로 보관 로그 검색',
  ],
  全部来源: [
    'All sources',
    'すべてのソース',
    'Toutes les sources',
    '모든 소스',
  ],
  '代理核心 · sing-box': [
    'Proxy core · sing-box',
    'プロキシコア · sing-box',
    'Cœur proxy · sing-box',
    '프록시 코어 · sing-box',
  ],
  '管理 API': ['Management API', '管理 API', 'API de gestion', '관리 API'],
  运行管理器: [
    'Runtime manager',
    '実行マネージャー',
    'Gestionnaire d’exécution',
    '런타임 관리자',
  ],
  内置均衡器: [
    'Built-in balancer',
    '内蔵バランサー',
    'Équilibreur intégré',
    '내장 밸런서',
  ],
  全部等级: ['All levels', 'すべてのレベル', 'Tous les niveaux', '모든 수준'],
  '搜索错误、节点名、端口或消息内容': [
    'Search errors, node names, ports, or messages',
    'エラー、ノード名、ポート、メッセージを検索',
    'Rechercher erreurs, nœuds, ports ou messages',
    '오류, 노드 이름, 포트 또는 메시지 검색',
  ],
  '查询中…': ['Searching…', '検索中…', 'Recherche…', '검색 중…'],
  没有匹配日志: [
    'No matching logs',
    '一致するログがありません',
    'Aucun journal correspondant',
    '일치하는 로그 없음',
  ],
  '调整来源、等级或搜索关键字后重试。': [
    'Change the source, level, or search terms and try again.',
    'ソース、レベル、検索語を変更してください。',
    'Modifiez la source, le niveau ou les mots-clés puis réessayez.',
    '소스, 수준 또는 검색어를 변경한 후 다시 시도하세요.',
  ],
  '用户操作、真实探测结果和状态变化': [
    'User actions, real probe results, and status changes',
    'ユーザー操作、実チェック結果、状態変化',
    'Actions utilisateur, sondes réelles et changements d’état',
    '사용자 작업, 실제 검사 결과 및 상태 변경',
  ],
  采集与存储策略: [
    'Collection and retention',
    '収集・保存ポリシー',
    'Collecte et conservation',
    '수집 및 보관 정책',
  ],
  '修改后无需重启容器；核心配置会自动安全重载。': [
    'Changes apply without restarting the container; core configuration reloads safely.',
    'コンテナ再起動は不要で、コア設定は安全に再読み込みされます。',
    'Les changements s’appliquent sans redémarrer le conteneur ; le cœur est rechargé en sécurité.',
    '컨테이너 재시작 없이 적용되며 코어 구성이 안전하게 다시 로드됩니다.',
  ],
  流量监控: [
    'Traffic monitoring',
    'トラフィック監視',
    'Surveillance du trafic',
    '트래픽 모니터링',
  ],
  '控制 HAProxy 统计套接字的读取频率与历史数据容量': [
    'Control HAProxy polling frequency and traffic history capacity',
    'HAProxy 統計ソケットの読取頻度と履歴容量を制御',
    'Contrôlez la fréquence HAProxy et la capacité de l’historique',
    'HAProxy 통계 조회 주기와 기록 용량 제어',
  ],
  '采样间隔（秒）': [
    'Sample interval (seconds)',
    'サンプル間隔（秒）',
    'Intervalle d’échantillonnage (secondes)',
    '샘플 간격(초)',
  ],
  流量明细保留天数: [
    'Traffic retention (days)',
    'トラフィック保存日数',
    'Conservation du trafic (jours)',
    '트래픽 보관 일수',
  ],
  最低记录等级: [
    'Minimum log level',
    '最小ログレベル',
    'Niveau de journal minimal',
    '최소 로그 수준',
  ],
  日志保留天数: [
    'Log retention (days)',
    'ログ保存日数',
    'Conservation des journaux (jours)',
    '로그 보관 일수',
  ],
  '统一控制面板、代理核心和 HAProxy 的日志留存': [
    'Manage dashboard, proxy core, and HAProxy log retention',
    'ダッシュボード、プロキシコア、HAProxy のログ保存を管理',
    'Gérez la conservation des journaux du panneau, du cœur proxy et de HAProxy',
    '대시보드, 프록시 코어 및 HAProxy 로그 보관 관리',
  ],
  当前预计刷新延迟: [
    'Estimated refresh latency',
    '現在の推定更新遅延',
    'Latence de rafraîchissement estimée',
    '예상 새로고침 지연',
  ],
  '页面刷新会跟随采样间隔，最低约 1 秒。': [
    'The dashboard follows the sample interval, down to about one second.',
    '画面更新はサンプル間隔に従い、最短約 1 秒です。',
    'Le tableau de bord suit l’intervalle, jusqu’à environ une seconde.',
    '대시보드는 샘플 간격을 따르며 최소 약 1초입니다.',
  ],
  保存并应用: [
    'Save and apply',
    '保存して適用',
    'Enregistrer et appliquer',
    '저장 및 적용',
  ],
  界面语言: [
    'Interface language',
    '表示言語',
    'Langue de l’interface',
    '인터페이스 언어',
  ],
  语言与区域: [
    'Language and region',
    '言語と地域',
    'Langue et région',
    '언어 및 지역',
  ],
  选择管理面板的显示语言: [
    'Choose the language used by the management dashboard',
    '管理画面の表示言語を選択します',
    'Choisissez la langue du tableau de bord',
    '관리 대시보드 표시 언어 선택',
  ],
  '语言设置会保存在服务器上，并应用到所有浏览器。': [
    'Language is stored on the server and applies to every browser.',
    '言語設定はサーバーに保存され、すべてのブラウザに適用されます。',
    'La langue est enregistrée sur le serveur et s’applique à tous les navigateurs.',
    '언어 설정은 서버에 저장되며 모든 브라우저에 적용됩니다.',
  ],
  系统设置已保存: [
    'Settings saved',
    '設定を保存しました',
    'Paramètres enregistrés',
    '설정 저장됨',
  ],
  '采样调度、日志等级和界面语言已经实时生效。': [
    'Sampling, log level, and interface language are now active.',
    'サンプリング、ログレベル、表示言語を適用しました。',
    'L’échantillonnage, le niveau de journal et la langue sont appliqués.',
    '샘플링, 로그 수준 및 인터페이스 언어가 적용되었습니다.',
  ],
  保存失败: [
    'Save failed',
    '保存に失敗しました',
    'Échec de l’enregistrement',
    '저장 실패',
  ],
  操作失败: [
    'Operation failed',
    '操作に失敗しました',
    'Échec de l’opération',
    '작업 실패',
  ],
  未知错误: [
    'Unknown error',
    '不明なエラー',
    'Erreur inconnue',
    '알 수 없는 오류',
  ],
  无法连接本地服务: [
    'Unable to reach the local service',
    'ローカルサービスに接続できません',
    'Impossible de joindre le service local',
    '로컬 서비스에 연결할 수 없음',
  ],
  '请确认 API 已启动。': [
    'Make sure the API is running.',
    'API が起動していることを確認してください。',
    'Vérifiez que l’API est démarrée.',
    'API가 실행 중인지 확인하세요.',
  ],
  '正在连接 KitsuneGate...': [
    'Connecting…',
    '接続中…',
    'Connexion…',
    '연결 중…',
  ],
  尚未检测: [
    'Never checked',
    '未チェック',
    'Jamais contrôlé',
    '검사 기록 없음',
  ],
  暂无配置: [
    'No configuration available',
    '設定がありません',
    'Aucune configuration',
    '사용 가능한 구성 없음',
  ],
  复制: ['Copy', 'コピー', 'Copier', '복사'],
  配置已复制: [
    'Configuration copied',
    '設定をコピーしました',
    'Configuration copiée',
    '구성 복사됨',
  ],
  '正在生成配置...': [
    'Generating configuration…',
    '設定を生成中…',
    'Génération de la configuration…',
    '구성 생성 중…',
  ],
  'sing-box 已接管流量；内置均衡器负责端口分流。': [
    'sing-box handles proxy traffic; the built-in balancer routes listener ports.',
    'sing-box がプロキシ通信を処理し、内蔵バランサーが待受ポートを振り分けます。',
    'sing-box gère le trafic proxy ; l’équilibreur intégré distribue les ports d’écoute.',
    'sing-box가 프록시 트래픽을 처리하고 내장 밸런서가 수신 포트를 분배합니다.',
  ],
  'sing-box 已接管流量；HAProxy负责端口分流。': [
    'sing-box handles proxy traffic; HAProxy routes listener ports.',
    'sing-box がプロキシ通信を処理し、HAProxy が待受ポートを振り分けます。',
    'sing-box gère le trafic proxy ; HAProxy distribue les ports d’écoute.',
    'sing-box가 프록시 트래픽을 처리하고 HAProxy가 수신 포트를 분배합니다.',
  ],
  'KitsuneGate 内置均衡器': [
    'KitsuneGate built-in balancer',
    'KitsuneGate 内蔵バランサー',
    'Équilibreur intégré KitsuneGate',
    'KitsuneGate 내장 밸런서',
  ],
  采样: ['sampling', 'サンプリング', 'échantillonnage', '샘플링'],
  '30分钟': ['30 min', '30 分', '30 min', '30분'],
  '1小时': ['1 hour', '1 時間', '1 heure', '1시간'],
  '6小时': ['6 hours', '6 時間', '6 heures', '6시간'],
  '12小时': ['12 hours', '12 時間', '12 heures', '12시간'],
  '24小时': ['24 hours', '24 時間', '24 heures', '24시간'],
  '7天': ['7 days', '7 日', '7 jours', '7일'],
  '30 分钟': ['30 min', '30 分', '30 min', '30분'],
  '1 小时': ['1 hour', '1 時間', '1 heure', '1시간'],
  '6 小时': ['6 hours', '6 時間', '6 heures', '6시간'],
  '12 小时': ['12 hours', '12 時間', '12 heures', '12시간'],
  '24 小时': ['24 hours', '24 時間', '24 heures', '24시간'],
  '7 天': ['7 days', '7 日', '7 jours', '7일'],
  聚合粒度: ['buckets', '集計間隔', 'granularité', '집계 간격'],
  来自: [
    'Live counters from',
    '取得元：',
    'Compteurs issus de',
    '실시간 카운터:',
  ],
  的真实累计字节计数: [
    'live cumulative byte counters',
    'の実累積バイトカウンター',
    'compteurs d’octets cumulés réels',
    '의 실제 누적 바이트 카운터',
  ],
  '支持 1–60 秒。1 秒最接近实时，但会增加 SQLite 写入和 HAProxy 管理套接字负载。':
    [
      'Choose 1–60 seconds. One second is the most responsive but increases SQLite writes and HAProxy socket load.',
      '1～60 秒に設定できます。1 秒は最もリアルタイムですが、SQLite 書込みと HAProxy ソケット負荷が増えます。',
      'Choisissez de 1 à 60 secondes. Une seconde est plus réactive mais augmente les écritures SQLite et la charge HAProxy.',
      '1~60초를 선택할 수 있습니다. 1초가 가장 실시간에 가깝지만 SQLite 쓰기와 HAProxy 소켓 부하가 늘어납니다.',
    ],
  '支持 1–30 天；趋势查询会依据时间范围自动使用 5 秒至 30 分钟的聚合粒度。': [
    'Retain 1–30 days. Trend queries automatically use 5-second to 30-minute buckets.',
    '1～30 日保存できます。期間に応じて 5 秒～30 分の間隔で自動集計します。',
    'Conservez de 1 à 30 jours. Les tendances utilisent automatiquement des intervalles de 5 secondes à 30 minutes.',
    '1~30일 보관할 수 있으며 기간에 따라 5초~30분 단위로 자동 집계합니다.',
  ],
  '该等级同时应用到 sing-box 输出和 KitsuneGate 日志入库过滤。': [
    'This level applies to sing-box output and KitsuneGate log storage.',
    'このレベルは sing-box 出力と KitsuneGate のログ保存に適用されます。',
    'Ce niveau s’applique à la sortie sing-box et au stockage des journaux KitsuneGate.',
    '이 수준은 sing-box 출력과 KitsuneGate 로그 저장에 모두 적용됩니다.',
  ],
  '支持 1–90 天，后台每分钟清理过期记录。': [
    'Retain 1–90 days. Expired records are removed every minute.',
    '1～90 日保存でき、期限切れの記録は毎分削除されます。',
    'Conservez de 1 à 90 jours. Les entrées expirées sont supprimées chaque minute.',
    '1~90일 보관할 수 있으며 만료된 기록은 매분 삭제됩니다.',
  ],
  'Debug · 诊断明细': [
    'Debug · diagnostic details',
    'Debug · 診断詳細',
    'Debug · détails de diagnostic',
    'Debug · 진단 세부 정보',
  ],
  'Info · 日常运行': [
    'Info · normal operation',
    'Info · 通常運用',
    'Info · fonctionnement normal',
    'Info · 일반 운영',
  ],
  'Warning · 警告及错误': [
    'Warning · warnings and errors',
    'Warning · 警告とエラー',
    'Warning · avertissements et erreurs',
    'Warning · 경고 및 오류',
  ],
  'Error · 仅错误': [
    'Error · errors only',
    'Error · エラーのみ',
    'Error · erreurs uniquement',
    'Error · 오류만',
  ],
  专用策略: [' policy', '専用ポリシー', ' · stratégie dédiée', ' 전용 정책'],
  '按节点“故障优先级”从小到大选择，主节点失败达到阈值后自动回退。': [
    'Select nodes by ascending failover priority and automatically fall back when the active node reaches its failure threshold.',
    'フェイルオーバー優先度の小さい順にノードを選択し、稼働ノードが失敗しきい値に達すると自動的に切り替えます。',
    'Sélectionne les nœuds par priorité de bascule croissante et bascule automatiquement lorsque le nœud actif atteint son seuil d’échec.',
    '장애 조치 우선순위가 낮은 노드부터 선택하고 활성 노드가 실패 임계값에 도달하면 자동으로 전환합니다.',
  ],
  '负载均衡使用“加权最少连接”算法。': [
    'Load balancing uses weighted least connections.',
    '負荷分散には重み付き最小接続アルゴリズムを使用します。',
    'L’équilibrage utilise l’algorithme du plus petit nombre de connexions pondéré.',
    '부하 분산은 가중 최소 연결 알고리즘을 사용합니다.',
  ],
  '负载均衡使用“加权轮询”算法。': [
    'Load balancing uses weighted round robin.',
    '負荷分散には重み付きラウンドロビンを使用します。',
    'L’équilibrage utilise la répartition cyclique pondérée.',
    '부하 분산은 가중 라운드 로빈을 사용합니다.',
  ],
  '负载均衡使用“按权重随机”算法。': [
    'Load balancing uses weighted random selection.',
    '負荷分散には重み付きランダム選択を使用します。',
    'L’équilibrage utilise une sélection aléatoire pondérée.',
    '부하 분산은 가중 무작위 선택을 사용합니다.',
  ],
  '根据真实 HTTP 检测延迟选择节点，延迟容差在“检测”页设置。': [
    'Select the node with the lowest real HTTP probe latency. Configure the switching tolerance on the Health tab.',
    '実際の HTTP プローブ遅延が最も低いノードを選択します。切替許容値は「ヘルス」タブで設定します。',
    'Sélectionne le nœud ayant la latence de sonde HTTP réelle la plus faible. Réglez la tolérance dans l’onglet Santé.',
    '실제 HTTP 검사 지연 시간이 가장 낮은 노드를 선택합니다. 전환 허용치는 상태 검사 탭에서 설정합니다.',
  ],
  '只使用节点页中手动选定的节点；选定节点不可用时连接会明确失败。': [
    'Use only the node selected on the Nodes tab. Connections fail explicitly when that node is unavailable.',
    '「ノード」タブで選択したノードのみを使用し、そのノードが利用できない場合は接続を明示的に失敗させます。',
    'Utilise uniquement le nœud choisi dans l’onglet Nœuds. La connexion échoue explicitement si ce nœud est indisponible.',
    '노드 탭에서 선택한 노드만 사용하며 해당 노드를 사용할 수 없으면 연결을 명확히 실패 처리합니다.',
  ],
  '检测会经节点独立的 sing-box SOCKS 适配端口发起真实 HTTP/HTTPS 请求。失败与恢复阈值用于抑制偶发网络抖动。':
    [
      'Checks send real HTTP/HTTPS requests through each node’s dedicated sing-box SOCKS adapter. Failure and recovery thresholds prevent brief network jitter from causing a switch.',
      '各ノード専用の sing-box SOCKS アダプターを経由して実際の HTTP/HTTPS リクエストを送信します。失敗・復旧しきい値で一時的なネットワーク揺らぎによる切替を抑えます。',
      'Les contrôles envoient de vraies requêtes HTTP/HTTPS via l’adaptateur SOCKS sing-box dédié de chaque nœud. Les seuils d’échec et de reprise évitent les bascules dues aux perturbations passagères.',
      '각 노드의 전용 sing-box SOCKS 어댑터를 통해 실제 HTTP/HTTPS 요청을 보냅니다. 실패 및 복구 임계값은 일시적인 네트워크 흔들림으로 인한 전환을 방지합니다.',
    ],
  '请求会通过每个节点自己的 sing-box SOCKS 适配端口访问检测地址，不再使用模拟结果。':
    [
      'Requests reach the check URL through each node’s own sing-box SOCKS adapter; results are never simulated.',
      '各ノード専用の sing-box SOCKS アダプター経由でチェック URL にアクセスし、模擬結果は使用しません。',
      'Les requêtes atteignent l’URL de contrôle via l’adaptateur SOCKS sing-box de chaque nœud ; aucun résultat n’est simulé.',
      '각 노드의 sing-box SOCKS 어댑터를 통해 검사 URL에 접속하며 모의 결과를 사용하지 않습니다.',
    ],
  'sing-box 配置已由真实核心加载。Windows 本地版使用内置 TCP 均衡器；HAProxy 配置为后续 Linux/Docker 部署保留。':
    [
      'The live core has loaded the sing-box configuration. The Windows build uses the built-in TCP balancer; the HAProxy configuration is retained for Linux and Docker deployments.',
      '実コアは sing-box 設定を読み込み済みです。Windows 版は内蔵 TCP バランサーを使用し、HAProxy 設定は Linux／Docker 配信用に保持されます。',
      'Le cœur actif a chargé la configuration sing-box. La version Windows utilise l’équilibreur TCP intégré ; la configuration HAProxy est conservée pour les déploiements Linux et Docker.',
      '실제 코어가 sing-box 구성을 불러왔습니다. Windows 버전은 내장 TCP 밸런서를 사용하며 HAProxy 구성은 Linux 및 Docker 배포용으로 유지됩니다.',
    ],
  'HAProxy（部署预览）': [
    'HAProxy (deployment preview)',
    'HAProxy（配備プレビュー）',
    'HAProxy (aperçu du déploiement)',
    'HAProxy(배포 미리보기)',
  ],
  'sing-box（当前运行）': [
    'sing-box (currently running)',
    'sing-box（現在稼働中）',
    'sing-box (actuellement actif)',
    'sing-box(현재 실행 중)',
  ],
  代理组已创建: [
    'Proxy group created',
    'プロキシグループを作成しました',
    'Groupe proxy créé',
    '프록시 그룹 생성됨',
  ],
  代理组设置已保存: [
    'Proxy group settings saved',
    'プロキシグループ設定を保存しました',
    'Paramètres du groupe proxy enregistrés',
    '프록시 그룹 설정 저장됨',
  ],
  代理组已删除: [
    'Proxy group deleted',
    'プロキシグループを削除しました',
    'Groupe proxy supprimé',
    '프록시 그룹 삭제됨',
  ],
  节点已删除: [
    'Node deleted',
    'ノードを削除しました',
    'Nœud supprimé',
    '노드 삭제됨',
  ],
  节点已添加并重载真实引擎: [
    'Node added and live engine reloaded',
    'ノードを追加して実エンジンを再読み込みしました',
    'Nœud ajouté et moteur actif rechargé',
    '노드가 추가되고 실제 엔진이 다시 로드됨',
  ],
  节点配置已保存并重载真实引擎: [
    'Node configuration saved and live engine reloaded',
    'ノード設定を保存して実エンジンを再読み込みしました',
    'Configuration du nœud enregistrée et moteur actif rechargé',
    '노드 구성이 저장되고 실제 엔진이 다시 로드됨',
  ],
  无法读取节点配置: [
    'Unable to load node configuration',
    'ノード設定を読み込めません',
    'Impossible de charger la configuration du nœud',
    '노드 구성을 불러올 수 없음',
  ],
  配置生成失败: [
    'Configuration generation failed',
    '設定の生成に失敗しました',
    'Échec de la génération de la configuration',
    '구성 생성 실패',
  ],
  '请检查运行日志。': [
    'Check the runtime logs.',
    '実行ログを確認してください。',
    'Consultez les journaux d’exécution.',
    '런타임 로그를 확인하세요.',
  ],
  真实引擎尚未启动: [
    'The live engine has not started',
    '実エンジンはまだ起動していません',
    'Le moteur actif n’a pas démarré',
    '실제 엔진이 아직 시작되지 않음',
  ],
  'sing-box 未就绪': [
    'sing-box not ready',
    'sing-box は準備できていません',
    'sing-box n’est pas prêt',
    'sing-box 준비되지 않음',
  ],
  'HAProxy 前端': [
    'HAProxy frontends',
    'HAProxy フロントエンド',
    'frontaux HAProxy',
    'HAProxy 프런트엔드',
  ],
  连接适配端口: [
    'Connect adapter',
    'アダプターへ接続',
    'Connexion à l’adaptateur',
    '어댑터 연결',
  ],
  记录选路状态: [
    'Record route state',
    '経路状態を記録',
    'Enregistrement du routage',
    '경로 상태 기록',
  ],
  适配端口: [
    'Adapter port',
    'アダプターポート',
    'Port adaptateur',
    '어댑터 포트',
  ],
  权重: ['Weight', 'ウェイト', 'Poids', '가중치'],
  优先级: ['Priority', '優先度', 'Priorité', '우선순위'],
  通过: ['passed', '成功', 'réussis', '통과'],
  耗时: ['Duration', '所要時間', 'Durée', '소요 시간'],
  连续成功: [
    'Consecutive successes',
    '連続成功',
    'Succès consécutifs',
    '연속 성공',
  ],
  连续失败: [
    'Consecutive failures',
    '連続失敗',
    'Échecs consécutifs',
    '연속 실패',
  ],
  '请先启用至少一个真实代理节点。': [
    'Enable at least one real proxy node first.',
    '先に実プロキシノードを 1 つ以上有効にしてください。',
    'Activez d’abord au moins un véritable nœud proxy.',
    '먼저 실제 프록시 노드를 하나 이상 활성화하세요.',
  ],
  '例如 US · CN2 05（JSON 标签可自动补全）': [
    'For example, US · CN2 05 (the JSON tag can fill this automatically)',
    '例：US · CN2 05（JSON タグから自動入力できます）',
    'Par exemple, US · CN2 05 (le tag JSON peut le remplir automatiquement)',
    '예: US · CN2 05(JSON 태그로 자동 입력 가능)',
  ],
  '例如 香港代理': [
    'For example, Hong Kong Proxy',
    '例：Hong Kong Proxy',
    'Par exemple, Hong Kong Proxy',
    '예: Hong Kong Proxy',
  ],
  等待真实检测: [
    'Awaiting a live check',
    '実チェック待ち',
    'En attente d’un contrôle réel',
    '실제 검사 대기 중',
  ],
  '每次检测都穿过节点协议栈与远端服务器，失败结果会进入选路策略和运行日志。': [
    'Every check traverses the node protocol stack and remote server. Failures feed into routing decisions and runtime logs.',
    '各チェックはノードのプロトコルスタックとリモートサーバーを通過し、失敗結果は経路選択と実行ログに反映されます。',
    'Chaque contrôle traverse la pile de protocoles du nœud et le serveur distant. Les échecs alimentent le routage et les journaux.',
    '모든 검사는 노드 프로토콜 스택과 원격 서버를 통과하며 실패 결과는 경로 선택과 런타임 로그에 반영됩니다.',
  ],
  '真实 HTTP/HTTPS 探测': [
    'Live HTTP/HTTPS probes',
    '実 HTTP/HTTPS プローブ',
    'Sondes HTTP/HTTPS réelles',
    '실제 HTTP/HTTPS 검사',
  ],
  检测全部: ['Check all', 'すべてチェック', 'Tout contrôler', '모두 검사'],
  确认故障: [
    'Confirmed failures',
    '確認済み障害',
    'Pannes confirmées',
    '확인된 장애',
  ],
  阈值观察中: [
    'Pending threshold',
    'しきい値監視中',
    'Seuil en observation',
    '임계값 관찰 중',
  ],
  设置: ['Settings', '設定', 'Paramètres', '설정'],
};

const localeIndexes: Record<Exclude<UiLanguage, 'zh-CN'>, number> = {
  en: 0,
  ja: 1,
  fr: 2,
  ko: 3,
};

function translateDynamic(
  value: string,
  language: Exclude<UiLanguage, 'zh-CN'>,
) {
  const index = localeIndexes[language];
  const rules: [RegExp, LocalizedValues][] = [
    [
      /^(\d+) 个监听端口正在接管流量$/,
      [
        '$1 listeners are carrying traffic',
        '$1 個の待受ポートがトラフィックを処理中',
        '$1 ports d’écoute transportent du trafic',
        '$1개 수신 포트가 트래픽 처리 중',
      ],
    ],
    [/^(\d+) 条结果$/, ['$1 results', '$1 件', '$1 résultats', '$1개 결과']],
    [
      /^(\d+)% 可用$/,
      ['$1% available', '$1% 利用可能', '$1 % disponibles', '$1% 사용 가능'],
    ],
    [/^累计 (\d+) 次$/, ['$1 total', '累計 $1 回', '$1 au total', '총 $1회']],
    [
      /^每 (\d+) 秒自动刷新$/,
      [
        'Refresh every $1 seconds',
        '$1 秒ごとに自動更新',
        'Actualisation toutes les $1 secondes',
        '$1초마다 자동 새로고침',
      ],
    ],
    [
      /^每 (\d+)\s*s 采样$/,
      [
        'Sample every $1s',
        '$1 秒ごとにサンプリング',
        'Échantillonnage toutes les $1 s',
        '$1초마다 샘플링',
      ],
    ],
    [
      /^下行 (.+) · 上行 (.+)$/,
      [
        'Download $1 · Upload $2',
        '下り $1 · 上り $2',
        'Descendant $1 · Montant $2',
        '다운로드 $1 · 업로드 $2',
      ],
    ],
    [
      /^(\d+)\s*s 聚合粒度$/,
      ['$1s buckets', '$1 秒集計', 'granularité $1 s', '$1초 집계'],
    ],
    [
      /^(.+) · 真实链路检测$/,
      [
        '$1 · live path check',
        '$1 · 実経路チェック',
        '$1 · contrôle du chemin réel',
        '$1 · 실제 경로 검사',
      ],
    ],
    [
      /^每 (\d+)s · 超时 (\d+)s · 失败 (\d+) 次下线$/,
      [
        'Every $1s · $2s timeout · offline after $3 failures',
        '$1 秒ごと · タイムアウト $2 秒 · $3 回失敗でオフライン',
        'Toutes les $1 s · délai $2 s · hors ligne après $3 échecs',
        '$1초마다 · 제한 시간 $2초 · $3회 실패 시 오프라인',
      ],
    ],
    [
      /^全局健康度 (\d+)%$/,
      [
        'Overall health $1%',
        '全体の健全性 $1%',
        'Santé globale $1 %',
        '전체 상태 $1%',
      ],
    ],
    [
      /^健康 \/ (\d+)$/,
      ['healthy / $1', '正常 / $1', 'sains / $1', '정상 / $1'],
    ],
    [
      /^确定删除“(.+)”及其全部节点吗？$/,
      [
        'Delete “$1” and all of its nodes?',
        '「$1」とそのすべてのノードを削除しますか？',
        'Supprimer « $1 » et tous ses nœuds ?',
        '“$1” 및 모든 노드를 삭제할까요?',
      ],
    ],
    [
      /^确定删除节点“(.+)”吗？$/,
      [
        'Delete node “$1”?',
        'ノード「$1」を削除しますか？',
        'Supprimer le nœud « $1 » ?',
        '“$1” 노드를 삭제할까요?',
      ],
    ],
  ];
  for (const [pattern, replacements] of rules) {
    if (pattern.test(value)) return value.replace(pattern, replacements[index]);
  }
  return value;
}

export function translateUiText(value: string, language: UiLanguage) {
  if (language === 'zh-CN') return value;
  const compact = value.replace(/\s+/g, ' ').trim();
  if (!compact) return value;
  const translated =
    phrases[compact]?.[localeIndexes[language]] ??
    translateDynamic(compact, language);
  if (translated === compact) return value;
  const leading = value.match(/^\s*/)?.[0] ?? '';
  const trailing = value.match(/\s*$/)?.[0] ?? '';
  return `${leading}${translated}${trailing}`;
}

const originalText = new WeakMap<Text, string>();
const renderedText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const renderedAttributes = new WeakMap<Element, Map<string, string>>();
const localizedAttributes = ['placeholder', 'title', 'aria-label'];

function localizeTextNode(node: Text, language: UiLanguage) {
  const current = node.nodeValue ?? '';
  if (
    !originalText.has(node) ||
    (renderedText.has(node) && current !== renderedText.get(node))
  ) {
    originalText.set(node, current);
  }
  const translated = translateUiText(
    originalText.get(node) ?? current,
    language,
  );
  renderedText.set(node, translated);
  if (current !== translated) node.nodeValue = translated;
}

function localizeElement(element: Element, language: UiLanguage) {
  let originals = originalAttributes.get(element);
  let rendered = renderedAttributes.get(element);
  if (!originals) {
    originals = new Map();
    originalAttributes.set(element, originals);
  }
  if (!rendered) {
    rendered = new Map();
    renderedAttributes.set(element, rendered);
  }
  for (const attribute of localizedAttributes) {
    const current = element.getAttribute(attribute);
    if (current === null) continue;
    if (
      !originals.has(attribute) ||
      (rendered.has(attribute) && current !== rendered.get(attribute))
    ) {
      originals.set(attribute, current);
    }
    const translated = translateUiText(
      originals.get(attribute) ?? current,
      language,
    );
    rendered.set(attribute, translated);
    if (current !== translated) element.setAttribute(attribute, translated);
  }
}

function localizeTree(root: Node, language: UiLanguage) {
  if (root.nodeType === Node.TEXT_NODE)
    localizeTextNode(root as Text, language);
  if (root.nodeType === Node.ELEMENT_NODE)
    localizeElement(root as Element, language);
  for (const child of root.childNodes) localizeTree(child, language);
}

export function useDocumentLocale(language: UiLanguage, ready = true) {
  useEffect(() => {
    const root = document.body;
    document.documentElement.lang = language;
    const localizedTitles: Record<UiLanguage, string> = {
      en: 'KitsuneGate · HAProxy Control Plane',
      'zh-CN': 'KitsuneGate · HAProxy 代理池控制台',
      ja: 'KitsuneGate · HAProxy プロキシプール管理',
      fr: 'KitsuneGate · Plan de contrôle HAProxy',
      ko: 'KitsuneGate · HAProxy 프록시 풀 제어판',
    };
    document.title = localizedTitles[language];
    localizeTree(root, language);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'characterData')
          localizeTextNode(mutation.target as Text, language);
        if (mutation.type === 'attributes')
          localizeElement(mutation.target as Element, language);
        for (const node of mutation.addedNodes) localizeTree(node, language);
      }
    });
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: localizedAttributes,
    });
    return () => observer.disconnect();
  }, [language, ready]);
}
