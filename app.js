(function () {
  "use strict";

  const data = window.PERSONALITY_DATA;
  const config = window.MBTI_CONFIG;
  if (!data || !config || !window.supabase) {
    throw new Error("The application or Supabase client could not be loaded.");
  }

  const supabaseClient = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );

  const PAGE_SIZE = 10;
  const roleNames = ["主導功能", "輔助功能", "第三功能", "弱勢功能"];
  const dimensions = [
    { left: "E", right: "I", leftName: "外向", rightName: "內向" },
    { left: "S", right: "N", leftName: "實感", rightName: "直覺" },
    { left: "T", right: "F", leftName: "思考", rightName: "情感" },
    { left: "J", right: "P", leftName: "判斷", rightName: "感知" },
  ];

  const screens = {
    intro: document.getElementById("introScreen"),
    test: document.getElementById("testScreen"),
    result: document.getElementById("resultScreen"),
  };
  const elements = {
    start: document.getElementById("startButton"),
    resume: document.getElementById("resumeButton"),
    saveExit: document.getElementById("saveExitButton"),
    logout: document.getElementById("logoutButton"),
    userEmail: document.getElementById("userEmail"),
    authForm: document.getElementById("authForm"),
    authTitle: document.getElementById("authTitle"),
    authModeLabel: document.getElementById("authModeLabel"),
    authSubtitle: document.getElementById("authSubtitle"),
    authMessage: document.getElementById("authMessage"),
    authSubmit: document.getElementById("authSubmitButton"),
    authSignupTab: document.getElementById("authSignupTab"),
    authLoginTab: document.getElementById("authLoginTab"),
    landingAuthCard: document.getElementById("landingAuthCard"),
    memberPanel: document.getElementById("memberPanel"),
    memberEmail: document.getElementById("memberEmail"),
    emailInput: document.getElementById("emailInput"),
    passwordInput: document.getElementById("passwordInput"),
    toast: document.getElementById("toast"),
    back: document.getElementById("backButton"),
    next: document.getElementById("nextButton"),
    restart: document.getElementById("restartButton"),
    list: document.getElementById("questionList"),
    validation: document.getElementById("validationMessage"),
    sectionLabel: document.getElementById("sectionLabel"),
    sectionTitle: document.getElementById("sectionTitle"),
    sectionDescription: document.getElementById("sectionDescription"),
    progressText: document.getElementById("progressText"),
    progressPercent: document.getElementById("progressPercent"),
    progressBar: document.getElementById("progressBar"),
    answeredCount: document.getElementById("answeredCount"),
    resultType: document.getElementById("resultType"),
    resultOverview: document.getElementById("resultOverview"),
    functionGrid: document.getElementById("functionGrid"),
  };

  let state = { page: 0, answers: {}, updatedAt: null };
  let currentUser = null;
  let cloudProgress = null;
  let cloudSaveTimer = null;
  let toastTimer = null;
  let authMode = "signup";
  const sessionTwoStart = data.questions.findIndex((question) => question.id === 27);
  const chunk = (items) => {
    const pages = [];
    for (let index = 0; index < items.length; index += PAGE_SIZE) {
      pages.push(items.slice(index, index + PAGE_SIZE));
    }
    return pages;
  };
  const questionPages = [
    ...chunk(data.questions.slice(0, sessionTwoStart)),
    ...chunk(data.questions.slice(sessionTwoStart)),
  ];
  const pageCount = questionPages.length;

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function storageKey() {
    return `personality-test-progress-v2-${currentUser?.id || "signed-out"}`;
  }

  function normalizeProgress(progress) {
    if (!progress || typeof progress.answers !== "object") return null;
    const rawPage = Number(progress.page ?? progress.current_page ?? 0);
    return {
      page: Math.min(Math.max(rawPage, 0), pageCount - 1),
      answers: progress.answers,
      updatedAt: progress.updatedAt || progress.updated_at || null,
    };
  }

  function readSavedState() {
    try {
      return normalizeProgress(JSON.parse(localStorage.getItem(storageKey())));
    } catch {
      return null;
    }
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.remove("hidden");
    toastTimer = window.setTimeout(() => elements.toast.classList.add("hidden"), 3600);
  }

  async function saveCloudProgress() {
    if (!currentUser) return;
    const { error } = await supabaseClient.from("assessment_progress").upsert(
      {
        user_id: currentUser.id,
        answers: state.answers,
        current_page: state.page,
        updated_at: state.updatedAt || new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) showToast("雲端儲存暫時失敗；本機進度仍然保留。 ");
  }

  function saveState({ cloud = true } = {}) {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(storageKey(), JSON.stringify(state));
    if (cloud && currentUser) {
      window.clearTimeout(cloudSaveTimer);
      cloudSaveTimer = window.setTimeout(saveCloudProgress, 450);
    }
  }

  async function loadCloudProgress() {
    if (!currentUser) return null;
    const { data: progress, error } = await supabaseClient
      .from("assessment_progress")
      .select("answers,current_page,updated_at")
      .eq("user_id", currentUser.id)
      .maybeSingle();
    if (error) {
      showToast("未能讀取雲端進度，暫時使用本機資料。");
      return null;
    }
    return normalizeProgress(progress);
  }

  function newestProgress(localProgress, remoteProgress) {
    if (!localProgress) return remoteProgress;
    if (!remoteProgress) return localProgress;
    return Date.parse(localProgress.updatedAt || 0) >= Date.parse(remoteProgress.updatedAt || 0)
      ? localProgress
      : remoteProgress;
  }

  async function refreshResumeAvailability() {
    cloudProgress = await loadCloudProgress();
    const best = newestProgress(readSavedState(), cloudProgress);
    const hasProgress = Boolean(currentUser && best && Object.keys(best.answers).length);
    elements.resume.classList.toggle("hidden", !hasProgress);
  }

  function showScreen(name) {
    Object.entries(screens).forEach(([key, screen]) => screen.classList.toggle("hidden", key !== name));
    elements.saveExit.classList.toggle("hidden", name !== "test");
    window.scrollTo({ top: 0, behavior: "smooth" });
    document.getElementById("main").focus({ preventScroll: true });
  }

  function updateAuthUi() {
    const signedIn = Boolean(currentUser);
    elements.logout.classList.toggle("hidden", !signedIn);
    elements.userEmail.classList.toggle("hidden", !signedIn);
    elements.userEmail.textContent = currentUser?.email || "";
    elements.landingAuthCard.classList.toggle("hidden", signedIn);
    elements.memberPanel.classList.toggle("hidden", !signedIn);
    elements.memberEmail.textContent = currentUser?.email || "";
    if (!signedIn) elements.resume.classList.add("hidden");
  }

  function setAuthMode(mode) {
    authMode = mode;
    const signingUp = mode === "signup";
    elements.authModeLabel.textContent = signingUp ? "CREATE YOUR ACCOUNT" : "WELCOME BACK";
    elements.authTitle.textContent = signingUp ? "建立帳戶" : "登入";
    elements.authSubtitle.textContent = signingUp
      ? "用 Email 同 Password 建立帳戶，完成電郵確認後即可登入。"
      : "登入後開始或繼續你嘅測驗。";
    elements.authSubmit.textContent = signingUp ? "建立帳戶" : "登入";
    elements.authSignupTab.classList.toggle("active", signingUp);
    elements.authLoginTab.classList.toggle("active", !signingUp);
    elements.authSignupTab.setAttribute("aria-pressed", String(signingUp));
    elements.authLoginTab.setAttribute("aria-pressed", String(!signingUp));
    elements.passwordInput.autocomplete = signingUp ? "new-password" : "current-password";
    elements.authMessage.classList.add("hidden");
    elements.authMessage.classList.remove("success");
  }

  function setAuthMessage(message, success = false) {
    elements.authMessage.textContent = message;
    elements.authMessage.classList.remove("hidden");
    elements.authMessage.classList.toggle("success", success);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    if (!elements.authForm.reportValidity()) return;

    const email = elements.emailInput.value.trim();
    const password = elements.passwordInput.value;
    elements.authSubmit.disabled = true;
    elements.authSubmit.textContent = authMode === "signup" ? "建立緊帳戶…" : "登入緊…";
    elements.authMessage.classList.add("hidden");

    if (authMode === "signup") {
      const redirectTo = `${window.location.origin}${window.location.pathname}`;
      const { data: signUpData, error } = await supabaseClient.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: redirectTo },
      });
      if (error) {
        setAuthMessage("暫時未能建立帳戶。請檢查 Email、Password，或稍後再試。");
      } else if (!signUpData.session) {
        setAuthMessage("帳戶已建立。請到收件箱確認 Email，之後返回此頁登入。", true);
      } else {
        setAuthMessage("帳戶已建立並成功登入。", true);
        window.setTimeout(() => showScreen("intro"), 700);
      }
    } else {
      const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthMessage("登入失敗。請檢查 Email、Password，並確認已完成電郵驗證。");
      } else {
        elements.authForm.reset();
        showScreen("intro");
        showToast("登入成功。");
      }
    }

    elements.authSubmit.disabled = false;
    elements.authSubmit.textContent = authMode === "signup" ? "建立帳戶" : "登入";
  }

  function sectionInfo(question) {
    const isWordPair = question.id >= 27 && question.id <= 58 || question.id >= 79;
    return isWordPair
      ? {
          label: "第二部分",
          title: "詞語取向",
          description: "選擇更能反映你的詞語，不需理會字型或讀音。",
        }
      : {
          label: "第一部分",
          title: "日常情境",
          description: "選擇最貼近你一般感受或行為的一項。",
        };
  }

  function renderPage() {
    const startIndex = questionPages
      .slice(0, state.page)
      .reduce((count, pageQuestions) => count + pageQuestions.length, 0);
    const questions = questionPages[state.page];
    const info = sectionInfo(questions[0]);
    const answered = Object.keys(state.answers).length;
    const progress = Math.round((answered / data.questions.length) * 100);

    elements.sectionLabel.textContent = info.label;
    elements.sectionTitle.textContent = info.title;
    elements.sectionDescription.textContent = info.description;
    elements.progressText.textContent = `第 ${startIndex + 1}–${startIndex + questions.length} 題`;
    elements.progressPercent.textContent = `${progress}%`;
    elements.progressBar.style.width = `${progress}%`;
    elements.answeredCount.textContent = String(answered);
    elements.back.disabled = state.page === 0;
    elements.back.style.visibility = state.page === 0 ? "hidden" : "visible";
    elements.next.textContent = state.page === pageCount - 1 ? "查看結果" : "下一頁";
    elements.validation.classList.add("hidden");

    elements.list.innerHTML = questions
      .map((question, index) => {
        const answer = state.answers[question.id];
        const absoluteNumber = startIndex + index + 1;
        return `
          <fieldset class="question-card" data-question-id="${question.id}">
            <legend class="visually-hidden">第 ${absoluteNumber} 題：${escapeHtml(question.text)}</legend>
            <p class="question-number">QUESTION ${String(absoluteNumber).padStart(2, "0")}</p>
            <h3 class="question-text">${escapeHtml(question.text)}</h3>
            <div class="option-grid">
              ${["A", "B"]
                .map(
                  (choice) => `
                    <label class="option-card ${answer === choice ? "selected" : ""}">
                      <input type="radio" name="question-${question.id}" value="${choice}" ${answer === choice ? "checked" : ""} />
                      <span class="option-letter" aria-hidden="true">${choice}</span>
                      <span class="option-copy">${escapeHtml(question[`option${choice}`])}</span>
                    </label>
                  `,
                )
                .join("")}
            </div>
          </fieldset>
        `;
      })
      .join("");

    elements.list.querySelectorAll("input[type=radio]").forEach((input) => {
      input.addEventListener("change", handleAnswer);
    });
  }

  function handleAnswer(event) {
    const card = event.target.closest(".question-card");
    const id = Number(card.dataset.questionId);
    state.answers[id] = event.target.value;
    card.classList.remove("has-error");
    card.querySelectorAll(".option-card").forEach((option) => {
      option.classList.toggle("selected", option.contains(event.target));
    });
    const answered = Object.keys(state.answers).length;
    const progress = Math.round((answered / data.questions.length) * 100);
    elements.progressPercent.textContent = `${progress}%`;
    elements.progressBar.style.width = `${progress}%`;
    elements.answeredCount.textContent = String(answered);
    saveState();
  }

  function validatePage() {
    const cards = [...elements.list.querySelectorAll(".question-card")];
    const unanswered = cards.filter((card) => !state.answers[card.dataset.questionId]);
    cards.forEach((card) => card.classList.toggle("has-error", unanswered.includes(card)));
    elements.validation.classList.toggle("hidden", unanswered.length === 0);
    if (unanswered.length) {
      unanswered[0].scrollIntoView({ behavior: "smooth", block: "center" });
      unanswered[0].querySelector("input").focus({ preventScroll: true });
      return false;
    }
    return true;
  }

  function calculateScores() {
    const scores = { E: 0, I: 0, S: 0, N: 0, T: 0, F: 0, J: 0, P: 0 };
    data.questions.forEach((question) => {
      const answer = state.answers[question.id];
      const trait = question.scoring[answer];
      if (trait) scores[trait] += 1;
    });
    return scores;
  }

  function chooseTrait(scores, left, right) {
    if (scores[left] === scores[right]) {
      const tieQuestion = data.questions.find(
        (question) => question.scoring.A === left || question.scoring.B === left,
      );
      return tieQuestion ? tieQuestion.scoring[state.answers[tieQuestion.id]] : right;
    }
    return scores[left] > scores[right] ? left : right;
  }

  function renderResults() {
    const scores = calculateScores();
    const type = dimensions.map(({ left, right }) => chooseTrait(scores, left, right)).join("");
    const profile = data.functions[type];
    elements.resultType.textContent = type;
    elements.resultOverview.textContent = data.overviews[type];

    elements.functionGrid.innerHTML = profile.functions
      .map(
        (fn, index) => `
          <article class="function-card">
            <span class="function-index" aria-hidden="true">${index + 1}</span>
            <p class="function-role">${roleNames[index]}</p>
            <h3>${escapeHtml(fn.type.replace(roleNames[index], "").trim())} · ${escapeHtml(fn.name)}</h3>
            <p>${escapeHtml(fn.description)}</p>
          </article>
        `,
      )
      .join("");

    return { scores, type };
  }

  async function startFresh() {
    if (!currentUser) {
      setAuthMode("signup");
      showScreen("intro");
      elements.emailInput.focus();
      return;
    }
    state = { page: 0, answers: {}, updatedAt: null };
    localStorage.removeItem(storageKey());
    await supabaseClient.from("assessment_progress").delete().eq("user_id", currentUser.id);
    saveState();
    renderPage();
    showScreen("test");
  }

  async function resumeTest() {
    if (!currentUser) {
      setAuthMode("login");
      showScreen("auth");
      return;
    }
    cloudProgress = await loadCloudProgress();
    state = newestProgress(readSavedState(), cloudProgress) || { page: 0, answers: {}, updatedAt: null };
    renderPage();
    showScreen("test");
  }

  elements.start.addEventListener("click", startFresh);
  elements.resume.addEventListener("click", resumeTest);
  elements.saveExit.addEventListener("click", async () => {
    saveState({ cloud: false });
    await saveCloudProgress();
    showScreen("intro");
    elements.resume.classList.remove("hidden");
    showToast("進度已保存。");
  });
  elements.back.addEventListener("click", () => {
    state.page = Math.max(0, state.page - 1);
    saveState();
    renderPage();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  elements.next.addEventListener("click", async () => {
    if (!validatePage()) return;
    if (state.page < pageCount - 1) {
      state.page += 1;
      saveState();
      renderPage();
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const { scores, type } = renderResults();
    const { error: resultError } = await supabaseClient.from("assessment_results").insert({
      user_id: currentUser.id,
      personality_type: type,
      scores,
      answers: state.answers,
      test_version: config.testVersion,
    });
    if (resultError) {
      showToast("結果已顯示，但暫時未能保存到雲端。");
    } else {
      await supabaseClient.from("assessment_progress").delete().eq("user_id", currentUser.id);
      localStorage.removeItem(storageKey());
      cloudProgress = null;
      showToast("結果已安全保存。");
    }
    showScreen("result");
  });
  elements.restart.addEventListener("click", async () => {
    localStorage.removeItem(storageKey());
    if (currentUser) {
      await supabaseClient.from("assessment_progress").delete().eq("user_id", currentUser.id);
    }
    elements.resume.classList.add("hidden");
    await startFresh();
  });
  document.querySelector("[data-action=home]").addEventListener("click", (event) => {
    event.preventDefault();
    if (!screens.test.classList.contains("hidden")) saveState();
    showScreen("intro");
    refreshResumeAvailability();
  });

  elements.logout.addEventListener("click", async () => {
    if (!screens.test.classList.contains("hidden")) {
      saveState({ cloud: false });
      await saveCloudProgress();
    }
    await supabaseClient.auth.signOut();
    currentUser = null;
    cloudProgress = null;
    updateAuthUi();
    showScreen("intro");
    showToast("已登出。");
  });
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.authSignupTab.addEventListener("click", () => setAuthMode("signup"));
  elements.authLoginTab.addEventListener("click", () => setAuthMode("login"));

  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAuthUi();
    window.setTimeout(refreshResumeAvailability, 0);
  });

  async function initialize() {
    const { data: sessionData } = await supabaseClient.auth.getSession();
    currentUser = sessionData.session?.user || null;
    updateAuthUi();
    setAuthMode("signup");
    if (currentUser) await refreshResumeAvailability();
  }

  initialize();
})();
