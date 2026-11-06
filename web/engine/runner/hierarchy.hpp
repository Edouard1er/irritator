// Contract adapter only. All expansion into executable models/connections is
// performed by libirritator's project::set, never by a second simulator.
struct native_hierarchy {
    const D& doc;
    const D& catalog;
    bool interface_root=false;
    struct summary {
        int atoms=0, instances=0, connections=0, depth=0;
        std::map<int,int> inputs, outputs;
    };
    std::map<std::string,const V*> definitions;
    std::map<std::string,summary> summaries;
    std::set<std::string> active;
    std::unique_ptr<irt::component_access> access;
    std::unique_ptr<irt::file_access> files;
    std::unique_ptr<irt::project> project;
    struct scope {
        irt::component_id id{};
        std::map<std::string,irt::child_id> children;
        std::map<int,irt::port_id> inputs, outputs;
    };
    std::map<std::string,scope> scopes;
    std::map<std::string,irt::model_id> models;
    irt_web::target_table targets;
    std::map<const V*,const irt_web::descriptor*> wrapper_descriptors;
    mutable std::map<std::pair<const V*,std::string>,V> wrapper_ports;
    mutable D port_storage;

    explicit native_hierarchy(const D& d,const D& c,bool root_interface=false):doc(d),catalog(c),interface_root(root_interface) {
        for(const auto& def:doc["model"]["definitions"].GetArray())
            if(!definitions.emplace(str(def["id"]),&def).second) fail("INVALID_MODEL","Duplicate definition");
        for(const auto& [id,def]:definitions) { validate(*def,true); }
        validate(doc["model"],interface_root);
        for(const auto& [id,def]:definitions) (void)describe(id,0);
        auto root=count(doc["model"],0);
        budget(root);
        if(!root.atoms) fail("INVALID_MODEL","No executable atomic model");
        std::set<std::string> observations;
        double estimated=0;
        const auto start=doc["simulation"]["start"].GetDouble(),end=doc["simulation"]["end"].GetDouble();
        for(const auto& o:doc["model"]["observations"].GetArray()) {
            const auto path=str(o["component"]);
            const V* scope=&doc["model"];
            std::size_t begin=0;
            while(true) {
                const auto slash=path.find('/',begin);
                const auto name=path.substr(begin,slash==std::string::npos?slash:slash-begin);
                const auto& c=child(*scope,name,"OBSERVATION_ERROR");
                if(slash==std::string::npos) {
                    if(str(c["type"])=="coupled" || str(c["type"])=="simulation_wrapper") fail("OBSERVATION_ERROR","Observe an atomic descendant with an observation function");
                    break;
                }
                if(str(c["type"])!="coupled") fail("OBSERVATION_ERROR","Path traverses an atomic model");
                scope=&definition(c); begin=slash+1;
            }
            if(!observations.insert(path).second) fail("OBSERVATION_ERROR","Duplicate observation");
            const auto dt=o["samplingInterval"].GetDouble();
            if(!(start+dt>start)||!(end+dt>end)) fail("OBSERVATION_ERROR","Sampling interval cannot advance time");
            estimated+=std::ceil((end-start)/dt)+2;
            if(estimated>limit(doc,"maxPoints",20000)) fail("LIMIT_EXCEEDED","Potential sampling grid exceeds maxPoints");
        }
    }
    const V& definition(const V& c) const {
        auto it=definitions.find(str(c["definition"]));
        if(it==definitions.end()) fail("DEFINITION_NOT_FOUND","Unknown coupled definition");
        return *it->second;
    }
    const V& child(const V& s,const std::string& name,const char* code="INVALID_SCOPE") const {
        for(const auto& c:s["components"].GetArray()) if(str(c["id"])==name) return c;
        fail(code,"Child outside current scope: "+name);
    }
    const V& ports(const V& c,const char* direction) const {
        if(str(c["type"])=="simulation_wrapper" && doc["schemaVersion"].GetInt()==3) {
            const auto key=std::make_pair(&c,std::string(direction));
            auto [it,inserted]=wrapper_ports.try_emplace(key,rapidjson::kArrayType);
            if(inserted) {
                // Values own their allocator: this document outlives validation.
                const auto& e=c["experiment"];
                const auto n=std::string(direction)=="inputs"?e["factors"].Size()+2:(e.HasMember("scenarioResults") && e["scenarioResults"].GetBool()?2*(e["factors"].Size()+e["selections"].Size())+2:e["factors"].Size()+e["selections"].Size());
                for(unsigned p=0;p<n;++p) { V item(rapidjson::kObjectType); item.AddMember("port",p,port_storage.GetAllocator()); it->second.PushBack(item,port_storage.GetAllocator()); }
            }
            return it->second;
        }
        return str(c["type"])=="coupled"?definition(c)[direction]:descriptor(catalog,str(c["type"]))[direction];
    }
    bool has_port(const V& list,int port) const {
        for(const auto& p:list.GetArray()) if(p["port"].GetInt()==port) return true;
        return false;
    }
    void validate(const V& s,bool external) const {
        std::set<std::string> names,edges;
        if(external) for(auto dir:{"inputs","outputs"}) {
            std::set<int> numbers; std::set<std::string> labels;
            for(const auto& p:s[dir].GetArray())
                if(!numbers.insert(p["port"].GetInt()).second || !labels.insert(str(p["name"])).second) fail("INVALID_EXTERNAL_PORT","Duplicate interface port");
        }
        for(const auto& c:s["components"].GetArray()) {
            if(!names.insert(str(c["id"])).second) fail("INVALID_MODEL","Duplicate local child id");
            if(str(c["type"])=="coupled") {
                (void)definition(c);
                if(c["parameters"].MemberCount()) fail("INVALID_PARAMETER","Coupled instances have shared definitions without overrides");
            } else if(str(c["type"])=="simulation_wrapper" && doc["schemaVersion"].GetInt()==3) {
                if(c["parameters"].MemberCount()) fail("INVALID_PARAMETER","Wrapper parameters must be empty; use experiment");
            } else {
                const auto& desc=descriptor(catalog,str(c["type"]));
                for(const auto& key:desc["required"].GetArray()) if(!c["parameters"].HasMember(key.GetString())) fail("INVALID_PARAMETER","Missing atomic parameter");
                for(auto p=c["parameters"].MemberBegin();p!=c["parameters"].MemberEnd();++p) {
                    if(!desc["parameters"].HasMember(p->name)) fail("INVALID_PARAMETER","Unknown atomic parameter");
                    const auto& b=desc["parameters"][p->name];
                    const auto value=p->value.GetDouble();
                    if((str(b["type"])=="integer" && std::floor(value)!=value)||!std::isfinite(value)||value<b["minimum"].GetDouble()||value>b["maximum"].GetDouble()) fail("INVALID_PARAMETER","Atomic parameter out of bounds");
                }
            }
        }
        for(const auto& e:s["connections"].GetArray()) {
            const auto f=str(e["from"]["component"]),t=str(e["to"]["component"]);
            const int fp=e["from"]["port"].GetInt(),tp=e["to"]["port"].GetInt();
            if(f==t || (f=="$input" && t=="$output")) fail("INVALID_CONNECTION","Unsupported self connection or interface passthrough");
            if(f.starts_with('$')) {
                if(!external||f!="$input"||!has_port(s["inputs"],fp)) fail("INVALID_EXTERNAL_PORT","Invalid external input");
            } else if(!has_port(ports(child(s,f),"outputs"),fp)) fail("INVALID_CONNECTION","Invalid source port");
            if(t.starts_with('$')) {
                if(!external||t!="$output"||!has_port(s["outputs"],tp)) fail("INVALID_EXTERNAL_PORT","Invalid external output");
            } else if(!has_port(ports(child(s,t),"inputs"),tp)) fail("INVALID_CONNECTION","Invalid target port");
            if(!edges.insert(f+":"+std::to_string(fp)+">"+t+":"+std::to_string(tp)).second) fail("INVALID_CONNECTION","Duplicate connection");
        }
    }
    void budget(const summary& s) const {
        if(s.atoms>limit(doc,"maxComponents",128)||s.instances>limit(doc,"maxInstances",512)||s.connections>limit(doc,"maxConnections",512)) fail("EXPANSION_LIMIT","Expanded model/instance/connection budget exceeded");
        if(s.depth>limit(doc,"maxDepth",8)) fail("HIERARCHY_DEPTH","Hierarchy depth budget exceeded");
    }
    summary describe(const std::string& id,int depth) {
        if(depth>8) fail("HIERARCHY_DEPTH","Hierarchy depth exceeded");
        if(active.contains(id)) fail("RECURSIVE_DEFINITION","Recursive coupled definition: "+id);
        if(summaries.contains(id)) return summaries.at(id);
        active.insert(id);
        auto ret=count(*definitions.at(id),depth);
        for(const auto& p:(*definitions.at(id))["inputs"].GetArray())
            if(!ret.inputs[p["port"].GetInt()]) fail("INVALID_EXTERNAL_PORT","Declared external input has no atomic endpoint");
        for(const auto& p:(*definitions.at(id))["outputs"].GetArray())
            if(!ret.outputs[p["port"].GetInt()]) fail("INVALID_EXTERNAL_PORT","Declared external output has no atomic endpoint");
        ret.depth++;
        budget(ret);
        active.erase(id); summaries.emplace(id,ret); return ret;
    }
    summary count(const V& s,int depth) {
        summary ret;
        std::map<std::string,summary> children;
        for(const auto& c:s["components"].GetArray()) {
            summary sub;
            if(str(c["type"])=="coupled") sub=describe(str(c["definition"]),depth+1);
            else {
                sub.atoms=1;
                for(const auto& p:ports(c,"inputs").GetArray()) sub.inputs[p["port"].GetInt()]=1;
                for(const auto& p:ports(c,"outputs").GetArray()) sub.outputs[p["port"].GetInt()]=1;
            }
            ret.atoms+=sub.atoms; ret.instances+=1+sub.instances;
            ret.connections+=sub.connections; ret.depth=std::max(ret.depth,sub.depth);
            budget(ret); children.emplace(str(c["id"]),sub);
        }
        for(const auto& e:s["connections"].GetArray()) {
            const auto f=str(e["from"]["component"]),t=str(e["to"]["component"]);
            const int fp=e["from"]["port"].GetInt(),tp=e["to"]["port"].GetInt();
            if(f=="$input") ret.inputs[fp]+=children.at(t).inputs[tp];
            else if(t=="$output") ret.outputs[tp]+=children.at(f).outputs[fp];
            else ret.connections+=children.at(f).outputs[fp]*children.at(t).inputs[tp];
            budget(ret);
            for(const auto& [p,n]:ret.inputs) if(n>512) fail("EXPANSION_LIMIT","Input fanout budget exceeded");
            for(const auto& [p,n]:ret.outputs) if(n>512) fail("EXPANSION_LIMIT","Output fanin budget exceeded");
        }
        return ret;
    }
    void prepare_access() {
        if(!access) access=std::make_unique<irt::component_access>(irt::modeling_reserve_definition{});
        if(!files) files=std::make_unique<irt::file_access>();
    }
    void build() {
        prepare_access();
        project=std::make_unique<irt::project>();
        for(const auto& [id,d]:definitions) declare(id,d);
        declare("$root",interface_root?&doc["model"]:nullptr);
        for(const auto& [id,d]:definitions) fill(id,*d);
        fill("$root",doc["model"]);
        // Reserve enough native edge storage for external fanout, before set.
        try {
            (void)irt_web::build_project(*project,*access,*files,scopes.at("$root").id);
        } catch(const std::exception& error) {
            fail("NATIVE_CONSTRUCTION_ERROR",error.what());
        }
        collect("$root",*project->tree_nodes.try_to_get(project->tn_head()),doc["model"],"");
        if(project->sim.models.size()!=models.size()) fail("NATIVE_CONSTRUCTION_ERROR","Native model remapping is incomplete");
        std::set<irt::model_id> distinct;
        for(const auto& [path,id]:models) if(!distinct.insert(id).second) fail("NATIVE_CONSTRUCTION_ERROR","Instance paths alias the same native model");
    }
    void declare(const std::string& name,const V* d) {
        if(!access->can_alloc_generic_component(1)) fail("NATIVE_CONSTRUCTION_ERROR","Cannot allocate native definition");
        scope s; s.id=irt_web::declare_component(*access);
        auto& c=access->components[s.id];
        if(d) {
            for(const auto& p:(*d)["inputs"].GetArray()) {
                const auto n=p["port"].GetInt(); s.inputs[n]=c.get_or_add_x("p"+std::to_string(n));
                if(!irt::is_defined(s.inputs[n])) fail("NATIVE_CONSTRUCTION_ERROR","Cannot allocate native input");
            }
            for(const auto& p:(*d)["outputs"].GetArray()) {
                const auto n=p["port"].GetInt(); s.outputs[n]=c.get_or_add_y("p"+std::to_string(n));
                if(!irt::is_defined(s.outputs[n])) fail("NATIVE_CONSTRUCTION_ERROR","Cannot allocate native output");
            }
        }
        scopes.emplace(name,std::move(s));
    }
    static irt::dynamics_type dynamics(const std::string& type) {
        if(const auto it=registry.find(type);it!=registry.end()) return it->second.dynamics;
        fail("UNKNOWN_COMPONENT","Missing native dynamics");
    }
    irt::connection::port port(const V& s,const V& e,bool input) {
        irt::connection::port ret;
        const auto& c=child(s,str(e["component"]));
        if(str(c["type"])=="coupled") {
            auto& native=scopes.at(str(c["definition"]));
            ret.compo=(input?native.inputs:native.outputs).at(e["port"].GetInt());
        } else ret.model=e["port"].GetInt();
        return ret;
    }
    void fill(const std::string& name,const V& s) {
        auto& scope=scopes.at(name);
        auto& gen=access->generic_components.get(access->components[scope.id].id.generic_id);
        for(const auto& c:s["components"].GetArray()) {
            const auto type=str(c["type"]);
            const auto name="n"+std::to_string(gen.children.max_used());
            const auto id=type=="coupled"?irt_web::add_child(gen,scopes.at(str(c["definition"])).id,name):
                type=="simulation_wrapper"?irt_web::add_wrapper(gen,name,*wrapper_descriptors.at(&c)):
                irt_web::add_child(gen,dynamics(type),name);
            scope.children.emplace(str(c["id"]),id);
            // Generated short names avoid native name_str truncation of JSON ids.
            set_parameters(gen.children_parameters[id],type,c["parameters"]);
        }
        const auto n=s["connections"].Size();
        gen.connections.reserve(n); gen.input_connections.reserve(n); gen.output_connections.reserve(n);
        for(const auto& e:s["connections"].GetArray()) {
            const auto f=str(e["from"]["component"]),t=str(e["to"]["component"]);
            if(f=="$input") check(gen.connect_input(scope.inputs.at(e["from"]["port"].GetInt()),gen.children.get(scope.children.at(t)),port(s,e["to"],true)),"NATIVE_CONSTRUCTION_ERROR","generic_component::connect_input");
            else if(t=="$output") check(gen.connect_output(scope.outputs.at(e["to"]["port"].GetInt()),gen.children.get(scope.children.at(f)),port(s,e["from"],false)),"NATIVE_CONSTRUCTION_ERROR","generic_component::connect_output");
            else check(gen.connect(gen.children.get(scope.children.at(f)),port(s,e["from"],false),gen.children.get(scope.children.at(t)),port(s,e["to"],true)),"NATIVE_CONSTRUCTION_ERROR","generic_component::connect");
        }
    }
    void collect(const std::string& name,irt::tree_node& tn,const V& s,const std::string& prefix) {
        for(const auto& c:s["components"].GetArray()) {
            const auto id=str(c["id"]),path=prefix+id;
            const auto& node=tn.children[scopes.at(name).children.at(id)];
            if(str(c["type"])=="coupled") {
                if(!node.is_tree_node()) fail("NATIVE_CONSTRUCTION_ERROR","Missing native instance");
                collect(str(c["definition"]),*node.tn,definition(c),path+"/");
            } else {
                if(!node.is_model()) fail("NATIVE_CONSTRUCTION_ERROR","Missing native atomic model");
                models.emplace(path,node.mdl);
                targets.emplace(path,irt_web::native_target{project->tree_nodes.get_id(tn),node.mdl});
            }
        }
    }
};
