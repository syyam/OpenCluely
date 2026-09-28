document.addEventListener('DOMContentLoaded', () => {    
    const logger = {
        info: (...args) => console.log('[SettingsWindowUI]', ...args)
    };

    // Get DOM elements
    const closeButton = document.getElementById('closeButton');
    const quitButton = document.getElementById('quitButton');
    const speechProviderSelect = document.getElementById('speechProvider');
    const azureKeyInput = document.getElementById('azureKey');
    const azureRegionInput = document.getElementById('azureRegion');
    const whisperCommandInput = document.getElementById('whisperCommand');
    const whisperModelInput = document.getElementById('whisperModel');
    const whisperLanguageInput = document.getElementById('whisperLanguage');
    const whisperDeviceSelect = document.getElementById('whisperDevice');
    const whisperCaptureModeSelect = document.getElementById('whisperCaptureMode');
    const whisperResponseTargetSelect = document.getElementById('whisperResponseTarget');
    const whisperSegmentMsInput = document.getElementById('whisperSegmentMs');
    const geminiKeyInput = document.getElementById('geminiKey');
    const geminiModelSelect = document.getElementById('geminiModel');
    const windowGapInput = document.getElementById('windowGap');
    const codingLanguageSelect = document.getElementById('codingLanguage');
    const codingFrameworkSelect = document.getElementById('codingFramework');

    // Options depend on the active profile, so they come from main.
    const fillFrameworkSelect = (options, value) => {
        if (!codingFrameworkSelect || !Array.isArray(options)) return;
        codingFrameworkSelect.innerHTML = '';
        options.forEach(({ id, label }) => codingFrameworkSelect.add(new Option(label, id)));
        codingFrameworkSelect.value = options.some(o => o.id === value) ? value : 'auto';
    };
    const iconGrid = document.getElementById('iconGrid');
    const resumeProfileSelect = document.getElementById('resumeProfile');
    const resumeContextInput = document.getElementById('resumeContext');
    const uploadResumeBtn = document.getElementById('uploadResumeBtn');
    const clearResumeBtn = document.getElementById('clearResumeBtn');
    const resumeStatus = document.getElementById('resumeStatus');
    const japaneseModeSelect = document.getElementById('japaneseMode');
    const interviewMetadataInput = document.getElementById('interviewMetadata');

    // Check if window.api exists
    if (!window.api) {
        console.error('window.api not available');
        return;
    }

    // Request current settings when window opens
    const requestCurrentSettings = () => {
        if (window.electronAPI && window.electronAPI.getSettings) {
            window.electronAPI.getSettings().then(settings => {
                loadSettingsIntoUI(settings);
            }).catch(error => {
                console.error('Failed to get settings:', error);
            });
        }
    };

    // Close button handler
    if (closeButton) {
        closeButton.addEventListener('click', () => {
            window.api.send('close-settings');
        });
    }

    // Quit button handler with multiple attempts
    if (quitButton) {
        quitButton.addEventListener('click', () => {
            try {
                // Try multiple ways to quit the app
                if (window.api && window.api.send) {
                    window.api.send('quit-app');
                }
                
                // Also try the electron API if available
                if (window.electronAPI && window.electronAPI.quit) {
                    window.electronAPI.quit();
                }
                
                // Fallback: close the window
                setTimeout(() => {
                    window.close();
                }, 500);
                
            } catch (error) {
                console.error('Error quitting app:', error);
                window.close();
            }
        });
    }

    // Function to load settings into UI
    const loadSettingsIntoUI = (settings) => {
        if (settings.speechProvider && speechProviderSelect) speechProviderSelect.value = settings.speechProvider;
        // Always set the input value, even if empty, so the user sees what's
        // currently configured (including env-derived defaults). Previously
        // empty strings were skipped which left stale UI values.
        if (azureKeyInput) azureKeyInput.value = settings.azureKey || '';
        if (azureRegionInput) azureRegionInput.value = settings.azureRegion || '';
        if (whisperCommandInput) whisperCommandInput.value = settings.whisperCommand || '';
        if (whisperModelInput) whisperModelInput.value = settings.whisperModel || '';
        if (whisperLanguageInput) whisperLanguageInput.value = settings.whisperLanguage || '';
        if (whisperDeviceSelect) whisperDeviceSelect.value = settings.whisperDevice || 'auto';
        if (whisperCaptureModeSelect) whisperCaptureModeSelect.value = settings.whisperCaptureMode || 'vad';
        if (whisperResponseTargetSelect) whisperResponseTargetSelect.value = settings.whisperResponseTarget || 'both';
        if (whisperSegmentMsInput) whisperSegmentMsInput.value = settings.whisperSegmentMs || '';
        if (geminiKeyInput) geminiKeyInput.value = settings.geminiKey || '';
        if (geminiModelSelect) geminiModelSelect.value = settings.geminiModel || 'gemini-3.5-flash-lite';
        if (windowGapInput) windowGapInput.value = settings.windowGap || '';

        // Set Kotlin as default if no coding language is specified, or if a
        // stored value (e.g. 'cpp'/'c') is no longer a valid option.
        if (codingLanguageSelect) {
            const validLanguages = Array.from(codingLanguageSelect.options).map(o => o.value);
            codingLanguageSelect.value = validLanguages.includes(settings.codingLanguage) ? settings.codingLanguage : 'kotlin';
        }
        fillFrameworkSelect(settings.frameworkOptions, settings.codingFramework);

        if (resumeProfileSelect) resumeProfileSelect.value = settings.resumeProfile || 'android';
        if (resumeContextInput) resumeContextInput.value = settings.resumeContext || '';
        if (japaneseModeSelect) japaneseModeSelect.value = settings.japaneseMode ? 'on' : 'off';
        if (interviewMetadataInput) interviewMetadataInput.value = settings.interviewMetadata || '';

        // Handle icon selection
        const selectedIcon = settings.selectedIcon || settings.appIcon;
        if (selectedIcon && iconGrid) {
            const iconOptions = iconGrid.querySelectorAll('.icon-option');
            iconOptions.forEach(option => {
                if (option.dataset.icon === selectedIcon) {
                    option.classList.add('selected');
                } else {
                    option.classList.remove('selected');
                }
            });
        }

        updateSpeechFieldStates();
    };

    // Load settings when window opens
    window.api.receive('load-settings', (settings) => {
        loadSettingsIntoUI(settings);
    });

    // Listen for settings window shown event
    if (window.electronAPI && window.electronAPI.receive) {
        window.electronAPI.receive('settings-window-shown', () => {
            requestCurrentSettings();
        });

    // Listen for coding language changes from other windows via helper
    window.electronAPI.onCodingLanguageChanged((event, data) => {
            if (data && data.language && codingLanguageSelect) {
                codingLanguageSelect.value = data.language;
                console.log('Language updated from overlay window:', data.language);
            }
    });

    if (window.electronAPI.onCodingFrameworkChanged) {
        window.electronAPI.onCodingFrameworkChanged((event, data) => {
            if (data) fillFrameworkSelect(data.options, data.framework);
        });
    }

    // Listen for Japanese-mode changes from the bar button so this select
    // can't drift out of sync with it.
    window.electronAPI.onJapaneseModeChanged((event, data) => {
            if (data && typeof data.enabled === 'boolean' && japaneseModeSelect) {
                japaneseModeSelect.value = data.enabled ? 'on' : 'off';
            }
    });
    }

    // Save settings helper function
    const saveSettings = () => {
        const settings = {};
        if (speechProviderSelect) settings.speechProvider = speechProviderSelect.value;
        if (azureKeyInput) settings.azureKey = azureKeyInput.value;
        if (azureRegionInput) settings.azureRegion = azureRegionInput.value;
        if (whisperCommandInput) settings.whisperCommand = whisperCommandInput.value;
        if (whisperModelInput) settings.whisperModel = whisperModelInput.value;
        if (whisperLanguageInput) settings.whisperLanguage = whisperLanguageInput.value;
        if (whisperDeviceSelect) settings.whisperDevice = whisperDeviceSelect.value;
        if (whisperCaptureModeSelect) settings.whisperCaptureMode = whisperCaptureModeSelect.value;
        if (whisperResponseTargetSelect) settings.whisperResponseTarget = whisperResponseTargetSelect.value;
        if (whisperSegmentMsInput) settings.whisperSegmentMs = whisperSegmentMsInput.value;
        if (geminiKeyInput) settings.geminiKey = geminiKeyInput.value;
        if (geminiModelSelect) settings.geminiModel = geminiModelSelect.value;
        if (windowGapInput) settings.windowGap = windowGapInput.value;
        if (codingLanguageSelect) settings.codingLanguage = codingLanguageSelect.value;
        if (resumeProfileSelect) settings.resumeProfile = resumeProfileSelect.value;
        if (resumeContextInput) settings.resumeContext = resumeContextInput.value;
        if (japaneseModeSelect) settings.japaneseMode = japaneseModeSelect.value === 'on';
        if (interviewMetadataInput) settings.interviewMetadata = interviewMetadataInput.value;

        window.api.send('save-settings', settings);
    };

    // Resume profile switch — saved on its own (not via the generic
    // saveSettings() helper, which would also send the textarea's current
    // value and could overwrite the newly-selected profile's saved resume
    // with whatever was still showing from the previous one). After saving,
    // reload settings so the textarea shows the new profile's own content.
    if (resumeProfileSelect) {
        resumeProfileSelect.addEventListener('change', async (e) => {
            if (!window.electronAPI || !window.electronAPI.saveSettings || !window.electronAPI.getSettings) return;
            await window.electronAPI.saveSettings({ resumeProfile: e.target.value });
            const settings = await window.electronAPI.getSettings();
            if (resumeContextInput) resumeContextInput.value = settings.resumeContext || '';
            resumeStatus.textContent = '';
        });
    }

    // Resume/background: upload a file, or edit the textarea directly.
    if (uploadResumeBtn) {
        uploadResumeBtn.addEventListener('click', async () => {
            if (!window.electronAPI || !window.electronAPI.uploadResumeFile) return;
            resumeStatus.textContent = 'Reading file...';
            try {
                const result = await window.electronAPI.uploadResumeFile();
                if (result.canceled) {
                    resumeStatus.textContent = '';
                    return;
                }
                if (!result.success) {
                    resumeStatus.textContent = `Error: ${result.error || 'Failed to read file'}`;
                    return;
                }
                if (resumeContextInput) resumeContextInput.value = result.text;
                resumeStatus.textContent = `Loaded from ${result.fileName}`;
            } catch (error) {
                resumeStatus.textContent = `Error: ${error.message}`;
            }
        });
    }

    if (clearResumeBtn) {
        clearResumeBtn.addEventListener('click', () => {
            if (resumeContextInput) resumeContextInput.value = '';
            resumeStatus.textContent = 'Cleared';
            saveSettings();
        });
    }

    if (resumeContextInput) {
        resumeContextInput.addEventListener('blur', () => {
            saveSettings();
            resumeStatus.textContent = 'Saved';
        });
    }

    if (interviewMetadataInput) {
        interviewMetadataInput.addEventListener('blur', () => {
            saveSettings();
        });
    }

    // Japanese mode — saved immediately on change (via electronAPI, not the
    // generic window.api.send path, so main.js's saveSettings() branch that
    // broadcasts 'japanese-mode-changed' fires right away and the bar
    // button's own toggle handler can't drift out of sync with this select).
    if (japaneseModeSelect) {
        japaneseModeSelect.addEventListener('change', (e) => {
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ japaneseMode: e.target.value === 'on' });
            } else {
                saveSettings();
            }
        });
    }

    const updateSpeechFieldStates = () => {
        const provider = speechProviderSelect ? speechProviderSelect.value : 'azure';

        // Show/hide provider-specific field groups instead of just disabling
        // them. This keeps the settings UI clean — only the relevant fields
        // for the selected provider are visible.
        const azureGroup = document.getElementById('azureFields');
        const whisperGroup = document.getElementById('whisperFields');
        const azureNote = document.getElementById('azureFieldsNote');

        if (azureGroup) {
            azureGroup.style.display = provider === 'azure' ? '' : 'none';
        }
        if (whisperGroup) {
            whisperGroup.style.display = provider === 'whisper' ? '' : 'none';
        }
        if (azureNote) {
            azureNote.style.display = provider === 'azure' ? '' : 'none';
        }

        // Also toggle disabled attribute for any leftover direct field refs
        [azureKeyInput, azureRegionInput].forEach(input => {
            if (input) input.disabled = provider !== 'azure';
        });
        [whisperCommandInput, whisperModelInput, whisperLanguageInput, whisperDeviceSelect,
            whisperCaptureModeSelect, whisperResponseTargetSelect, whisperSegmentMsInput].forEach(input => {
            if (input) input.disabled = provider !== 'whisper';
        });
    };

    // Add event listeners for all inputs
    const inputs = [
        azureKeyInput,
        azureRegionInput,
        whisperCommandInput,
        whisperModelInput,
        whisperLanguageInput,
        whisperDeviceSelect,
        whisperCaptureModeSelect,
        whisperResponseTargetSelect,
        whisperSegmentMsInput,
        geminiKeyInput,
        geminiModelSelect,
        windowGapInput
    ];

    inputs.forEach(input => {
        if (input) {
            input.addEventListener('change', saveSettings);
            input.addEventListener('blur', saveSettings);
        }
    });

    if (speechProviderSelect) {
        speechProviderSelect.addEventListener('change', () => {
            updateSpeechFieldStates();
            saveSettings();
        });
    }

    // Language selection handler
    if (codingLanguageSelect) {
        codingLanguageSelect.addEventListener('change', (e) => {
            const lang = e.target.value;
            // use electronAPI so main broadcast is consistent
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ codingLanguage: lang });
            } else {
                // fallback
                saveSettings();
            }
        });
    }

    // Framework: saved on its own (not in the bulk saveSettings above) so a
    // profile switch never re-sends a stale pick from the old profile.
    if (codingFrameworkSelect) {
        codingFrameworkSelect.addEventListener('change', (e) => {
            if (window.electronAPI && window.electronAPI.saveSettings) {
                window.electronAPI.saveSettings({ codingFramework: e.target.value });
            }
        });
    }

    updateSpeechFieldStates();

    // Initialize icon grid with correct paths
    const initializeIconGrid = () => {
        if (!iconGrid) return;

        const icons = [
            { key: 'terminal', name: 'Terminal', src: './assests/icons/terminal.png' },
            { key: 'activity', name: 'Activity', src: './assests/icons/activity.png' },
            { key: 'settings', name: 'Settings', src: './assests/icons/settings.png' }
        ];

        iconGrid.innerHTML = '';

        icons.forEach(icon => {
            const iconElement = document.createElement('div');
            iconElement.className = 'icon-option';
            iconElement.dataset.icon = icon.key;
            
            const img = document.createElement('img');
            img.src = icon.src;
            img.alt = icon.name;
            img.onload = () => {
                logger.info('Icon loaded successfully:', icon.src);
            };
            img.onerror = () => {
                console.error('Failed to load icon:', icon.src);
                // Try alternative paths
                const altPaths = [
                    `./assests/${icon.key}.png`,
                    `./assets/icons/${icon.key}.png`,
                    `./assets/${icon.key}.png`
                ];
                
                let pathIndex = 0;
                const tryNextPath = () => {
                    if (pathIndex < altPaths.length) {
                        img.src = altPaths[pathIndex];
                        pathIndex++;
                    } else {
                        img.style.display = 'none';
                        console.error('All icon paths failed for:', icon.key);
                    }
                };
                
                img.onload = () => {
                    logger.info('Icon loaded with alternative path:', img.src);
                };
                
                img.onerror = tryNextPath;
                tryNextPath();
            };
            
            const label = document.createElement('div');
            label.textContent = icon.name;
            
            iconElement.appendChild(img);
            iconElement.appendChild(label);
            
            // Click handler for icon selection
            iconElement.addEventListener('click', () => {                
                // Remove selection from all icons
                iconGrid.querySelectorAll('.icon-option').forEach(opt => {
                    opt.classList.remove('selected');
                });
                
                // Add selection to clicked icon
                iconElement.classList.add('selected');
                
                // Save the selection - this should trigger the app icon change
                window.api.send('save-settings', { selectedIcon: icon.key });
                
                // Show visual feedback
                iconElement.style.transform = 'scale(0.95)';
                setTimeout(() => {
                    iconElement.style.transform = 'scale(1)';
                }, 100);
            });
            
            iconGrid.appendChild(iconElement);
        });
    };

    // Initialize icon grid
    initializeIconGrid();

    // Request settings on load
    setTimeout(() => {
        requestCurrentSettings();
    }, 200);

    // ESC key to close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            window.api.send('close-settings');
        }
    });
}); 
