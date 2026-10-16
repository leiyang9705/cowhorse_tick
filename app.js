const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    // --- 状态 ---
    const currentTab = ref('home');
    const tokenInput = ref(localStorage.getItem('gh_token') || '');
    const gistId = ref(localStorage.getItem('gh_gist_id') || '');
    const records = ref([]);
    const settings = ref({ workStartTime: '09:00', workEndTime: '18:00' });
    const loading = ref(false);

    // --- 计算属性 ---
    const todayStr = computed(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    const todayRecord = computed(() => records.value.find(r => r.date === todayStr.value));

    const todayOvertime = computed(() => {
      if (!todayRecord.value?.clockIn || !todayRecord.value?.clockOut) return 0;
      const [inH, inM] = todayRecord.value.clockIn.split(':').map(Number);
      const [outH, outM] = todayRecord.value.clockOut.split(':').map(Number);
      const totalMin = (outH * 60 + outM) - (inH * 60 + inM);
      const overMin = totalMin - (8 * 60); // 假设标准8小时
      return Math.max(0, Math.round((overMin / 60) * 10) / 10);
    });

    // --- API 封装 ---
    const getHeaders = () => ({
      'Authorization': `token ${tokenInput.value}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json'
    });

    const fetchData = async () => {
      if (!gistId.value) return;
      loading.value = true;
      try {
        const res = await fetch(`https://api.github.com/gists/${gistId.value}`, { headers: getHeaders() });
        if (!res.ok) throw new Error('获取数据失败');
        const data = await res.json();
        const content = JSON.parse(data.files['cowhorse_data.json'].content);
        records.value = content.records || [];
        settings.value = content.settings || settings.value;
      } catch (e) {
        alert(e.message);
      } finally {
        loading.value = false;
      }
    };

    const pushData = async () => {
      const payload = {
        files: {
          'cowhorse_data.json': {
            content: JSON.stringify({ version: '1.0', settings: settings.value, records: records.value }, null, 2)
          }
        }
      };
      const res = await fetch(`https://api.github.com/gists/${gistId.value}`, {
        method: 'PATCH', headers: getHeaders(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('同步云端失败');
    };

    const createGist = async () => {
      const payload = {
        description: 'CowHorse Tick Data',
        public: false,
        files: {
          'cowhorse_data.json': {
            content: JSON.stringify({ version: '1.0', settings: settings.value, records: [] }, null, 2)
          }
        }
      };
      const res = await fetch('https://api.github.com/gists', {
        method: 'POST', headers: getHeaders(), body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('创建 Gist 失败，请检查 Token 权限');
      const data = await res.json();
      return data.id;
    };

    // --- 业务方法 ---
    const handleClock = async (type) => {
      if (loading.value) return;
      loading.value = true;
      try {
        const now = new Date();
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
        
        let rec = records.value.find(r => r.date === todayStr.value);
        if (!rec) {
          rec = { id: todayStr.value, date: todayStr.value, clockIn: null, clockOut: null, overtimeHours: 0, note: '' };
          records.value.unshift(rec);
        }

        if (type === 'in') rec.clockIn = timeStr;
        else {
          rec.clockOut = timeStr;
          rec.overtimeHours = todayOvertime.value;
        }

        await pushData();
        alert(type === 'in' ? '上班打卡成功！' : '下班打卡成功！');
      } catch (e) {
        alert(e.message);
      } finally {
        loading.value = false;
      }
    };

    const bindGist = async () => {
      if (!tokenInput.value) return alert('请输入 Token');
      loading.value = true;
      try {
        localStorage.setItem('gh_token', tokenInput.value);
        if (!gistId.value) {
          const newId = await createGist();
          localStorage.setItem('gh_gist_id', newId);
          gistId.value = newId;
        }
        await fetchData();
        alert('绑定成功！');
      } catch (e) {
        alert(e.message);
      } finally {
        loading.value = false;
      }
    };

    const saveSettings = async () => {
      if (!gistId.value) return;
      loading.value = true;
      try {
        await pushData();
      } catch (e) {
        alert(e.message);
      } finally {
        loading.value = false;
      }
    };

    const clearAuth = () => {
      localStorage.removeItem('gh_token');
      localStorage.removeItem('gh_gist_id');
      tokenInput.value = '';
      gistId.value = '';
      records.value = [];
      alert('已清除');
    };

    // --- 初始化 ---
    onMounted(() => {
      if (gistId.value) fetchData();
    });

    return {
      currentTab, tokenInput, gistId, records, settings, loading,
      todayStr, todayRecord, todayOvertime,
      handleClock, bindGist, saveSettings, clearAuth
    };
  }
});

app.mount('#app');
