const { createApp, ref, computed, onMounted } = Vue;

const app = createApp({
  setup() {
    // --- 状态 ---
    const currentTab = ref('home');
    const tokenInput = ref(localStorage.getItem('gh_token') || '');
    const gistId = ref(localStorage.getItem('gh_gist_id') || '');
    const records = ref([]);
    const settings = ref({ 
      workStartTime: '09:00', 
      workEndTime: '18:00',
      flexibleMinutes: 0,
      bufferMinutes: 0
    });
    const loading = ref(false);

    // 修改弹窗状态
    const showEditModal = ref(false);
    const editingRecord = ref(null);
    const editClockIn = ref('');
    const editClockOut = ref('');

    // --- 计算属性 ---
    const todayStr = computed(() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });

    const todayRecord = computed(() => records.value.find(r => r.date === todayStr.value));

    // 核心：加班计算逻辑 (包含缓冲时间)
    const calcOvertime = (clockIn, clockOut) => {
      if (!clockIn || !clockOut) return 0;
      const [stdH, stdM] = settings.value.workEndTime.split(':').map(Number);
      const buffer = settings.value.bufferMinutes || 0;
      
      // 开始计算加班的基准时间 (分钟)
      const baseOvertimeStartMin = stdH * 60 + stdM + buffer;
      
      const [outH, outM] = clockOut.split(':').map(Number);
      const clockOutMin = outH * 60 + outM;
      
      if (clockOutMin <= baseOvertimeStartMin) return 0;
      
      const overtimeMin = clockOutMin - baseOvertimeStartMin;
      return Math.round((overtimeMin / 60) * 10) / 10;
    };

    // 核心：迟到判断逻辑 (包含弹性时间)
    const checkLate = (clockIn) => {
      if (!clockIn) return false;
      const [stdH, stdM] = settings.value.workStartTime.split(':').map(Number);
      const flexible = settings.value.flexibleMinutes || 0;
      
      const latestStartMin = stdH * 60 + stdM + flexible;
      const [inH, inM] = clockIn.split(':').map(Number);
      const clockInMin = inH * 60 + inM;
      
      return clockInMin > latestStartMin;
    };

    const todayOvertime = computed(() => {
      if (!todayRecord.value) return 0;
      return calcOvertime(todayRecord.value.clockIn, todayRecord.value.clockOut);
    });

    const isLate = computed(() => checkLate(todayRecord.value?.clockIn));

    // --- 统计计算属性 ---
    const getWeekStart = (date) => {
      const d = new Date(date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      d.setDate(diff);
      return d.toISOString().slice(0, 10);
    };

    const weeklyOvertime = computed(() => {
      const weekStart = getWeekStart(new Date());
      return records.value.filter(r => r.date >= weekStart).reduce((sum, r) => sum + r.overtimeHours, 0);
    });

    const monthlyOvertime = computed(() => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      return records.value.filter(r => r.date.startsWith(currentMonth)).reduce((sum, r) => sum + r.overtimeHours, 0);
    });

    const quarterlyOvertime = computed(() => {
      const now = new Date();
      const threeMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
      const startDate = threeMonthsAgo.toISOString().slice(0, 10);
      return records.value.filter(r => r.date >= startDate).reduce((sum, r) => sum + r.overtimeHours, 0);
    });

    const monthlyRecords = computed(() => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      return records.value.filter(r => r.date.startsWith(currentMonth));
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
        settings.value = { ...settings.value, ...content.settings };
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
            content: JSON.stringify({ version: '1.1', settings: settings.value, records: records.value }, null, 2)
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
            content: JSON.stringify({ version: '1.1', settings: settings.value, records: [] }, null, 2)
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
          rec.overtimeHours = calcOvertime(rec.clockIn, rec.clockOut);
        }

        await pushData();
        alert(type === 'in' ? '上班打卡成功！' : '下班打卡成功！');
      } catch (e) {
        alert(e.message);
      } finally {
        loading.value = false;
      }
    };

    // 修改记录逻辑
    const openEditModal = (rec) => {
      editingRecord.value = rec;
      editClockIn.value = rec.clockIn || '';
      editClockOut.value = rec.clockOut || '';
      showEditModal.value = true;
    };

    const closeEditModal = () => {
      showEditModal.value = false;
      editingRecord.value = null;
    };

    const saveEdit = async () => {
      if (!editingRecord.value) return;
      loading.value = true;
      try {
        editingRecord.value.clockIn = editClockIn.value || null;
        editingRecord.value.clockOut = editClockOut.value || null;
        // 重新计算加班时长
        editingRecord.value.overtimeHours = calcOvertime(editingRecord.value.clockIn, editingRecord.value.clockOut);
        
        await pushData();
        alert('修改成功！');
        closeEditModal();
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
        // 设置改变后，重新计算所有记录的加班时长
        records.value.forEach(rec => {
          rec.overtimeHours = calcOvertime(rec.clockIn, rec.clockOut);
        });
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

    onMounted(() => {
      if (gistId.value) fetchData();
    });

    return {
      currentTab, tokenInput, gistId, records, settings, loading,
      todayStr, todayRecord, todayOvertime, isLate,
      weeklyOvertime, monthlyOvertime, quarterlyOvertime, monthlyRecords,
      handleClock, bindGist, saveSettings, clearAuth,
      checkLate,
      showEditModal, editingRecord, editClockIn, editClockOut,
      openEditModal, closeEditModal, saveEdit
    };
  }
});

app.mount('#app');
