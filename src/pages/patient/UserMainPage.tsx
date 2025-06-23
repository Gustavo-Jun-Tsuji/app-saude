import { useNavigate } from 'react-router-dom';
import HomeBanner from '@/components/ui/home-banner';
import { X } from 'lucide-react';
import BottomNavigationBar from '@/components/ui/navigator-bar';
import { useState, useEffect } from 'react';
import { InterestAreasService } from '@/api/services/InterestAreasService';
import type { InterestArea } from '@/api/models/InterestArea';
import type { InterestAreaTrigger } from '@/api/models/InterestAreaTrigger';
import { Button } from '@/components/forms/button';
import SuccessMessage from '@/components/ui/success-message';
import ErrorMessage from '@/components/ui/error-message';
import EditInterestDialog from '../../components/EditInterestsDialog';
import { ConfirmDialog } from '@/components/ui/confirmDialog';
import { ApiService } from '@/api';
import { TypeEnum } from '@/api/models/TypeEnum';

interface InterestAreaResponse {
  observation_id?: number;
  person_id: number | null;
  interest_area: InterestArea;
  is_temporary?: boolean;
  is_deleted?: boolean;
  is_modified?: boolean;
  attention_point_date?: string;
  marked_by?: string[];
  provider_name?: string;
}

// Interface for the dialog data format
interface DialogInterestData {
  id?: string;
  interest_name: string;
  triggers: InterestAreaTrigger[];
}

export default function UserMainPage() {
  const navigate = useNavigate();

  // Estados principais
  const [userInterestObjects, setUserInterestObjects] = useState<InterestAreaResponse[]>([]);
  const [originalInterests, setOriginalInterests] = useState<InterestAreaResponse[]>([]);

  // Para comparar mudanças
  const [editionMode, setEditionMode] = useState(false);
  const [editingInterest, setEditingInterest] = useState<InterestAreaResponse | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [interestToDelete, setInterestToDelete] = useState<InterestAreaResponse | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Estados de sincronização
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncSuccess, setSyncSuccess] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Load user's existing interests on component mount
  useEffect(() => {
    const loadExistingInterests = async () => {
      try {
        const userEntity = await ApiService.apiUserEntityRetrieve();
        const userInterests = await InterestAreasService.apiInterestAreaList(userEntity.person_id);

        console.log('Dados da API:', userInterests);

        // Ensure all interests have proper structure
        const normalizedInterests = userInterests.map((interest: InterestAreaResponse) => ({
          ...interest,
          interest_area: {
            ...interest.interest_area,
            name: String(interest.interest_area?.name || ''),
            triggers: Array.isArray(interest.interest_area?.triggers)
              ? interest.interest_area.triggers.map((trigger: InterestAreaTrigger) => ({
                  name: String(trigger?.name || trigger || ''),
                  type: trigger?.type || TypeEnum.TEXT,
                  response: trigger?.response || null,
                }))
              : [],
          },
          marked_by: Array.isArray(interest.marked_by)
            ? interest.marked_by.map((provider: string) => String(provider || ''))
            : [],
          is_temporary: false,
          is_deleted: false,
          is_modified: false,
        }));

        console.log('Interesses normalizados:', normalizedInterests);

        // flag is_attention_point
        for (const interest of normalizedInterests) {
          if (interest.marked_by && interest.marked_by.length > 0) {
            interest.interest_area.is_attention_point = true;
          } else {
            interest.interest_area.is_attention_point = false;
          }
        }

        setUserInterestObjects(normalizedInterests);
        setOriginalInterests([...normalizedInterests]);
        setHasChanges(false);
      } catch (error) {
        console.error('Error loading user interests:', error);
        setSyncError('Erro ao carregar interesses. Tente novamente.');
      }
    };

    loadExistingInterests();
  }, []);

  // Função para deletar interesse APENAS LOCALMENTE
  const deleteInterestLocally = (interest: InterestAreaResponse) => {
    if (interest.is_temporary) {
      setUserInterestObjects((prev) =>
        prev.filter((i) => i.observation_id !== interest.observation_id),
      );
    } else {
      setUserInterestObjects((prev) =>
        prev.map((i) =>
          i.observation_id === interest.observation_id ? { ...i, is_deleted: true } : i,
        ),
      );
    }
    setHasChanges(true);
  };

  // Função para salvar interesse APENAS LOCALMENTE
  const saveInterestLocally = (interestData: DialogInterestData) => {
    console.log('saveInterestLocally chamado:', interestData);

    if (interestData.id) {
      // Editando interesse existente
      setUserInterestObjects((prev) =>
        prev.map((interest) =>
          interest.observation_id?.toString() === interestData.id
            ? {
                ...interest,
                interest_area: {
                  ...interest.interest_area,
                  name: interestData.interest_name,
                  triggers: interestData.triggers.map((trigger) => ({
                    name: String(trigger.name || ''),
                    type: trigger.type || TypeEnum.TEXT,
                    response: trigger.response || null,
                  })),
                },
                is_modified: true,
              }
            : interest,
        ),
      );
    } else {
      // Criando novo interesse temporário
      const tempInterest: InterestAreaResponse = {
        observation_id: -Date.now(), // Temporary negative ID
        person_id: null,
        interest_area: {
          name: interestData.interest_name,
          is_attention_point: false,
          marked_by: [],
          triggers: interestData.triggers.map((trigger) => ({
            name: String(trigger.name || ''),
            type: trigger.type || TypeEnum.TEXT,
            response: trigger.response || null,
          })),
        },
        is_temporary: true,
        is_deleted: false,
        is_modified: false,
        marked_by: [],
      };

      setUserInterestObjects((prev) => [...prev, tempInterest]);
    }

    console.log('Marcando hasChanges = true');
    setHasChanges(true);
  };

  // Função para sincronizar com servidor
  const syncWithServer = async () => {
    setIsSyncing(true);
    setSyncError(null);

    try {
      // 1. Delete marked interests
      const toDelete = userInterestObjects.filter((i) => i.is_deleted && !i.is_temporary);

      for (const interest of toDelete) {
        if (interest.observation_id) {
          await InterestAreasService.apiInterestAreaDestroy(interest.observation_id.toString());
        }
      }

      // 2. Create new temporary interests
      const toCreate = userInterestObjects.filter((i) => i.is_temporary && !i.is_deleted);
      const createdInterests = [];

      for (const interest of toCreate) {
        try {
          const newInterestArea = {
            interest_area: {
              name: interest.interest_area.name,
              triggers:
                interest.interest_area.triggers?.map((t) => ({
                  name: String(t.name || ''),
                  type: t.type || TypeEnum.TEXT,
                  response: t.response || null,
                })) || [],
              marked_by: [],
              is_attention_point: false,
              shared_with_provider: false,
            },
          };

          const result = await InterestAreasService.apiInterestAreaCreate(newInterestArea);

          if (result) {
            createdInterests.push({
              observation_id: result.observation_id,
              person_id: result.person_id,
              interest_area: result.interest_area,
              provider_name: '',
              is_temporary: false,
              is_deleted: false,
              is_modified: false,
            } as InterestAreaResponse);
          }
        } catch (error) {
          console.error('Error creating interest:', error);
          setSyncError(`Erro ao criar interesse: ${interest.interest_area.name}`);
        }
      }

      // 3. Update modified interests
      const toUpdate = userInterestObjects.filter(
        (i) => !i.is_temporary && !i.is_deleted && i.is_modified,
      );
      const updatedInterests = [];

      for (const interest of toUpdate) {
        if (!interest.observation_id) continue;

        try {
          const updateData = {
            interest_area: {
              name: interest.interest_area.name,
              triggers:
                interest.interest_area.triggers?.map((t) => ({
                  name: String(t.name || ''),
                  type: t.type || TypeEnum.TEXT,
                  response: t.response || null,
                })) || [],
              is_attention_point: interest.interest_area.is_attention_point || false,
              marked_by: interest.interest_area.marked_by || [],
              shared_with_provider: interest.interest_area.shared_with_provider || false,
            },
          };

          const result = await InterestAreasService.apiInterestAreaUpdate(
            interest.observation_id.toString(),
            updateData,
          );

          if (result) {
            updatedInterests.push({
              observation_id: result.observation_id,
              person_id: result.person_id,
              interest_area: result.interest_area,
              marked_by: result.marked_by || [],
              attention_point_date: interest.attention_point_date,
              is_temporary: false,
              is_deleted: false,
              is_modified: false,
            } as InterestAreaResponse);
          }
        } catch (error: unknown) {
          console.error(`Error updating interest ${interest.observation_id}:`, error);
          setSyncError(`Erro ao atualizar: ${interest.interest_area.name}`);
        }
      }

      // 4. Build final state
      const finalInterests = [
        ...userInterestObjects.filter((i) => !i.is_temporary && !i.is_deleted && !i.is_modified),
        ...createdInterests,
        ...updatedInterests,
      ];

      setUserInterestObjects(finalInterests);
      setOriginalInterests([...finalInterests]);
      setHasChanges(false);
      setSyncSuccess(true);
      setTimeout(() => setSyncSuccess(false), 3000);
    } catch (error: unknown) {
      console.error('Error syncing with server:', error);
      setSyncError('Erro ao salvar interesses. Tente novamente.');
    } finally {
      setIsSyncing(false);
    }
  };

  // Navigation functions
  const handleBannerIconClick = () => {
    navigate('/diary');
  };

  const getActiveNavId = () => {
    if (location.pathname.startsWith('/user-main-page')) return 'home';
    if (location.pathname.startsWith('/reminders')) return 'meds';
    if (location.pathname.startsWith('/diary')) return 'diary';
    if (location.pathname.startsWith('/emergency-user')) return 'emergency';
    if (location.pathname.startsWith('/profile')) return 'profile';
    return null;
  };

  const handleNavigationClick = (itemId: string) => {
    switch (itemId) {
      case 'home':
        navigate('/user-main-page');
        break;
      case 'meds':
        navigate('/reminders');
        break;
      case 'diary':
        navigate('/diary');
        break;
      case 'emergency':
        navigate('/emergency-user');
        break;
      case 'profile':
        navigate('/profile');
        break;
    }
  };

  // Handlers para a interface
  const handleEditInterest = (interest: InterestAreaResponse) => {
    setEditingInterest(interest);
    setDialogOpen(true);
  };

  const handleCreateNewInterest = () => {
    setEditingInterest(null);
    setDialogOpen(true);
  };

  const handleDeleteInterest = (interest: InterestAreaResponse) => {
    setInterestToDelete(interest);
    setConfirmDeleteOpen(true);
  };

  const confirmDelete = () => {
    if (interestToDelete) {
      deleteInterestLocally(interestToDelete);
      setConfirmDeleteOpen(false);
      setInterestToDelete(null);
    }
  };

  const handleSaveInterest = (interestData: DialogInterestData) => {
    saveInterestLocally(interestData);
    setDialogOpen(false);
    setEditingInterest(null);
  };

  const handleSaveChanges = async () => {
    await syncWithServer();
    setEditionMode(false);
  };

  const handleCancelChanges = () => {
    const restoredInterests = originalInterests.map((interest) => ({
      ...interest,
      is_modified: false,
      is_deleted: false,
    }));

    setUserInterestObjects(restoredInterests);
    setHasChanges(false);
    setEditionMode(false);
  };

  // Filtrar interesses para exibição
  const visibleInterests = userInterestObjects.filter((i) => !i.is_deleted);

  return (
    <div className="min-h-screen bg-background relative">
      {/* HEADER fixo */}
      <div className="relative z-10 bg-background">
        <HomeBanner
          title="Registro diário"
          subtitle="Adicione seus interesses e acompanhe seu progresso"
          onIconClick={handleBannerIconClick}
        />
        <h2 className="text-titulowindow font-work-sans pl-4 pb-2 mt-4 text-typography">
          Meus Interesses
        </h2>
      </div>

      {/* ÁREA SCROLLÁVEL - Lista de Interesses COMPACTA E PRETTY */}
      <div
        className="px-4 overflow-y-auto"
        style={{
          paddingBottom: '180px',
          maxHeight: 'calc(100vh - 140px)',
        }}
      >
        {visibleInterests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-20 h-20 bg-gradient-to-br from-homebg/20 to-selection/20 rounded-2xl flex items-center justify-center mb-6 shadow-xl">
              <span className="text-4xl">🎯</span>
            </div>
            <p className="text-typography text-xl font-bold mb-3">Nenhum interesse selecionado</p>
            <p className="text-muted-foreground text-base max-w-md">
              Adicione seus interesses para começar a acompanhar seu bem-estar!
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {visibleInterests.map((interest) => (
              <div
                key={interest.observation_id}
                onClick={() => {
                  if (editionMode) {
                    handleEditInterest(interest);
                  }
                }}
                className={`
                  bg-card border rounded-2xl p-5 transition-all duration-300 relative group hover-lift
                  shadow-lg hover:shadow-xl
                  ${
                    interest.interest_area.is_attention_point
                      ? 'border-orange-300 bg-gradient-to-br from-orange-50/80 to-red-50/80 dark:from-orange-900/10 dark:to-red-900/10 dark:border-orange-400 shadow-orange-200/50 dark:shadow-orange-900/20'
                      : 'border-card-border hover:border-ring/40 shadow-slate-200/80 dark:shadow-slate-900/40'
                  }
                  ${editionMode ? 'cursor-pointer hover:scale-[1.02] hover:bg-accent/20' : ''}
                `}
              >
                {/* Botão de deletar compacto */}
                {editionMode && (
                  <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-200">
                    <button
                      className="w-7 h-7 bg-destructive/10 hover:bg-destructive text-destructive 
                              hover:text-destructive-foreground rounded-full flex items-center justify-center
                              transition-all duration-200 hover:scale-110 shadow-md border border-destructive/30"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteInterest(interest);
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                )}

                {/* Header compacto */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className={`w-3 h-3 rounded-full flex-shrink-0 shadow-sm ${
                      interest.interest_area.is_attention_point
                        ? 'bg-gradient-to-r from-orange-400 to-red-500'
                        : 'bg-[var(--gradient-interest-indicator)]'
                    }`}
                  />

                  <h3 className="font-bold text-base text-typography break-words leading-tight flex-1">
                    {String(interest.interest_area?.name || '')}
                  </h3>

                  {/* Badges compactos */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {interest.is_temporary && (
                      <span className="px-2 py-0.5 bg-yellow-500 text-white text-xs font-medium rounded-full shadow-sm">
                        💾
                      </span>
                    )}
                    {interest.interest_area.is_attention_point && (
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 dark:bg-orange-500/10 dark:text-orange-300 text-xs font-medium rounded-full border border-orange-300 dark:border-orange-700 shadow-sm">
                        ⚠️
                      </span>
                    )}
                    {interest.is_modified && (
                      <span className="px-2 py-0.5 bg-blue-500 text-white text-xs font-medium rounded-full shadow-sm">
                        ✏️
                      </span>
                    )}
                  </div>
                </div>

                {/* Provider Info compacta */}
                {interest.interest_area.is_attention_point && (
                  <div className="mb-3 p-3 bg-orange-100/90 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-800 rounded-lg shadow-inner">
                    <div className="flex items-center gap-2">
                      <span className="text-orange-700 dark:text-orange-400 text-xs">👤</span>
                      <span className="text-xs font-medium text-orange-800 dark:text-orange-300">
                        {String(interest.marked_by?.join(', ') || 'Profissional')}
                      </span>
                      {interest.attention_point_date && (
                        <span className="text-xs text-orange-700 dark:text-orange-400 ml-auto">
                          📅{' '}
                          {new Date(interest.attention_point_date).toLocaleDateString('pt-BR', {
                            day: '2-digit',
                            month: '2-digit',
                          })}
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Lista de triggers compacta com tipos */}
                <div className="space-y-1.5">
                  {Array.isArray(interest.interest_area.triggers) &&
                    interest.interest_area.triggers.map((trigger, index) => {
                      // Função para determinar tipo e ícone
                      const getTriggerTypeInfo = (triggerType: TypeEnum) => {
                        switch (triggerType) {
                          case TypeEnum.BOOLEAN:
                            return {
                              icon: '✓',
                              color: 'text-green-700 dark:text-green-400',
                              bg: 'bg-green-200 dark:bg-green-900/30',
                              label: 'Sim/Não',
                            };
                          case TypeEnum.SCALE:
                            return {
                              icon: '📊',
                              color: 'text-blue-700 dark:text-blue-400',
                              bg: 'bg-blue-200 dark:bg-blue-900/30',
                              label: 'Escala',
                            };
                          case TypeEnum.INT:
                            return {
                              icon: '🔢',
                              color: 'text-purple-700 dark:text-purple-400',
                              bg: 'bg-purple-200 dark:bg-purple-900/30',
                              label: 'Número',
                            };
                          case TypeEnum.TEXT:
                          default:
                            return {
                              icon: '📝',
                              color: 'text-slate-700 dark:text-slate-400',
                              bg: 'bg-slate-200 dark:bg-slate-800/50',
                              label: 'Texto',
                            };
                        }
                      };

                      const typeInfo = getTriggerTypeInfo(trigger.type || TypeEnum.TEXT);

                      return (
                        <div
                          key={`${trigger.name || index}-${index}`}
                          className="flex items-center gap-2 p-2 bg-card-muted rounded-lg border border-card-border hover:bg-accent/30 transition-colors duration-200 shadow-sm"
                        >
                          <div
                            className={`w-6 h-6 ${typeInfo.bg} rounded-lg flex items-center justify-center flex-shrink-0 shadow-sm`}
                          >
                            <span className="text-xs">{typeInfo.icon}</span>
                          </div>
                          <span className="text-sm text-typography break-words leading-relaxed flex-1 min-w-0">
                            {String(trigger?.name || '')}
                          </span>
                          <span
                            className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeInfo.bg} ${typeInfo.color} shadow-sm flex-shrink-0`}
                          >
                            {typeInfo.label}
                          </span>
                        </div>
                      );
                    })}
                </div>

                {/* Footer compacto */}
                <div className="mt-3 pt-3 border-t border-card-border/50">
                  <div className="flex items-center justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <div className="w-1.5 h-1.5 bg-muted-foreground/60 rounded-full" />
                      {interest.interest_area.triggers?.length || 0} pergunta
                      {(interest.interest_area.triggers?.length || 0) !== 1 ? 's' : ''}
                    </span>
                    {editionMode && (
                      <span className="text-selection font-medium hover:text-selection/80 transition-colors">
                        Clique para editar →
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* MENSAGENS DE SUCESSO/ERRO */}
      <div className="fixed bottom-36 left-0 right-0 px-4 z-20">
        {syncSuccess && (
          <div className="flex justify-center">
            <SuccessMessage
              message="Interesses salvos com sucesso!"
              className="animate-in slide-in-from-bottom-5 duration-300 shadow-lg backdrop-blur-sm"
            />
          </div>
        )}
        {syncError && (
          <div className="flex justify-center">
            <ErrorMessage
              message={syncError}
              variant="destructive"
              onClose={() => setSyncError(null)}
              onRetry={() => setSyncError(null)}
              className="animate-in slide-in-from-bottom-5 duration-300 shadow-lg backdrop-blur-sm"
            />
          </div>
        )}
      </div>

      {/* BOTÕES FIXOS */}
      <div className="fixed bottom-24 left-0 right-0 px-4 py-3 bg-gradient-button-background backdrop-blur-sm border-t border-gray2-border/20 z-20">
        {editionMode ? (
          <div className="flex justify-center gap-2 max-w-md mx-auto">
            <Button
              variant="outlineWhite"
              onClick={handleCancelChanges}
              className="flex-1 bg-offwhite/50 border-gray2-border/30 text-typography hover:bg-offwhite/70 transition-all duration-200 backdrop-blur-sm text-desc-titulo py-2"
              disabled={isSyncing}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleSaveChanges}
              className={`flex-1 bg-gradient-button-save hover:bg-gradient-button-save-hover text-white shadow-lg hover:shadow-xl transition-all duration-200 border-0 text-desc-titulo py-2 ${
                !hasChanges ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              disabled={isSyncing || !hasChanges}
            >
              {isSyncing ? '...' : hasChanges ? '✓ Salvar Mudanças' : '✓ Salvar'}
            </Button>
            <Button
              onClick={handleCreateNewInterest}
              className="flex-1 bg-gradient-button-new hover:bg-gradient-button-new-hover text-white shadow-lg hover:shadow-xl transition-all duration-200 border-0 text-desc-titulo py-2"
              disabled={isSyncing}
            >
              + Novo
            </Button>
          </div>
        ) : (
          <div className="w-full flex justify-center px-2">
            <Button
              onClick={() => setEditionMode(true)}
              className="bg-gradient-button-edit hover:bg-gradient-button-edit-hover text-white w-full max-w-xs shadow-lg hover:shadow-xl transition-all duration-300 transform hover:scale-105 py-2.5 rounded-xl font-semibold text-desc-titulo"
              disabled={isSyncing}
            >
              ✏️ Editar Interesses
            </Button>
          </div>
        )}
      </div>

      {/* NAVEGAÇÃO INFERIOR */}
      <div className="fixed bottom-0 left-0 right-0 z-30">
        <BottomNavigationBar
          variant="user"
          forceActiveId={getActiveNavId()}
          onItemClick={handleNavigationClick}
        />
      </div>

      {/* DIALOGS */}
      <EditInterestDialog
        open={dialogOpen}
        initialData={
          editingInterest
            ? {
                id: editingInterest.observation_id?.toString(),
                interest_name: String(editingInterest.interest_area?.name || ''),
                triggers: Array.isArray(editingInterest.interest_area?.triggers)
                  ? editingInterest.interest_area.triggers.map((t) => ({
                      name: String(t?.name || ''),
                      type: t?.type || TypeEnum.TEXT,
                      response: t?.response || null,
                    }))
                  : [],
              }
            : undefined
        }
        onClose={() => {
          setDialogOpen(false);
          setEditingInterest(null);
        }}
        onSave={handleSaveInterest}
      />

      <ConfirmDialog
        open={confirmDeleteOpen}
        title="Excluir Interesse"
        description={`Tem certeza que deseja excluir "${String(interestToDelete?.interest_area?.name || '')}"?`}
        onCancel={() => {
          setConfirmDeleteOpen(false);
          setInterestToDelete(null);
        }}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
